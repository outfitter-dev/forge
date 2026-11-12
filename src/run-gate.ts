import path from "node:path";

import type { PullRequestReads } from "./collect-pull-request-types.ts";
import { collectPullRequest } from "./collect-pull-request.ts";
import { evaluateEvidence } from "./evaluate-evidence.ts";
import { GATE_USAGE, parseGateArguments } from "./gate-arguments.ts";
import type { GateDocument, GateLedgerStop } from "./gate-document.ts";
import { readGateInputs } from "./gate-inputs.ts";
import {
  GitHubReadError,
  githubPullRequestReads,
} from "./github-pull-request-reads.ts";
import { normalizeCheckReceipts } from "./normalize-check-receipts.ts";
import { ReviewLedgerError } from "./review-ledger-entry.ts";
import {
  readReviewLedger,
  replaceReviewLedger,
} from "./review-ledger-store.ts";

/** The longest one request to GitHub may take. */
const REQUEST_TIMEOUT_MS = 15_000;
/** The most pages one REST list may span. */
const MAX_REST_PAGES = 50;
/** The most review-thread pages one pass may read. */
const MAX_THREAD_PAGES = 50;

export interface GateInvocation {
  /** The arguments after `gate`. */
  args: string[];
  /** Relative input files resolve against it, and state must be outside it. */
  cwd: string;
  /** The token is read from `FORGE_GITHUB_TOKEN` here and from nowhere else. */
  env: Record<string, string | undefined>;
}

const FRAME = { kind: "forge-gate", schemaVersion: 1 } as const;

/** Carries a ledger refusal out of the flow. It never leaves this module. */
class LedgerStoppedError extends Error {
  readonly stop: GateLedgerStop;

  constructor(stop: GateLedgerStop) {
    super(stop.code);
    this.name = "LedgerStoppedError";
    this.stop = stop;
  }
}

/** A ledger refusal keeps its fixed code. Its message can name a file, so it is dropped. */
const ledgerStep = async <T>(
  stage: GateLedgerStop["stage"],
  work: () => Promise<T>
): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ReviewLedgerError) {
      throw new LedgerStoppedError({ code: error.code, stage });
    }
    throw error;
  }
};

/**
 * The same reads, remembering the code and status of the first failure one of
 * them throws. The collector reports every thrown read as `read-failed`, so
 * without this an outage could not be told from a page bound that is too small.
 */
const remembering = (reads: PullRequestReads) => {
  let failure: { code: GitHubReadError["code"]; status: number | null } | null =
    null;
  const watch = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      if (failure === null && error instanceof GitHubReadError) {
        failure = { code: error.code, status: error.status };
      }
      throw error;
    }
  };
  const watched: PullRequestReads = {
    pullRequest: () => watch(() => reads.pullRequest()),
    reviewThreads: (cursor) => watch(() => reads.reviewThreads(cursor)),
    reviews: () => watch(() => reads.reviews()),
    timeline: () => watch(() => reads.timeline()),
  };
  return { failure: () => failure, reads: watched };
};

const gate = async ({
  args,
  cwd,
  env,
}: GateInvocation): Promise<GateDocument> => {
  const parsed = parseGateArguments(args);
  if (!parsed.valid) {
    return {
      ...FRAME,
      issues: parsed.issues,
      status: "invalid-input",
      usage: GATE_USAGE,
    };
  }
  const read = await readGateInputs(parsed.arguments, env, cwd);
  if (!read.valid) {
    return { ...FRAME, issues: read.issues, status: "invalid-input" };
  }
  const { pullRequest, repository, runId, state } = parsed.arguments;
  const { policy, receipts, reviewEvidence, token } = read.inputs;
  const location = {
    directory: path.join(path.resolve(state), "review-ledger"),
    pullRequest,
    repository,
  };
  // The machine's clock, read once, as a whole-second UTC time.
  const now = `${new Date().toISOString().slice(0, 19)}Z`;
  const entry = await ledgerStep("ledger-read", () =>
    readReviewLedger({ ...location, now })
  );
  const github = remembering(
    githubPullRequestReads({
      // Looked up now, when the command runs, not when this module loads.
      fetch: globalThis.fetch,
      maxPages: MAX_REST_PAGES,
      pullRequest,
      repository,
      timeoutMs: REQUEST_TIMEOUT_MS,
      token,
    })
  );
  const collection = await collectPullRequest(
    {
      // Passing the policy's label is what adopts the collector's rule for
      // `mergeAuthorized`; a policy without one was refused above.
      holdLabel: policy.mergeAuthorization.holdLabel,
      ledger: entry,
      maxThreadPages: MAX_THREAD_PAGES,
      provenance: {
        producer: policy.evidence.collector.producer,
        runId,
        runtimeFingerprint: policy.evidence.collector.runtimeFingerprint,
      },
      pullRequest,
      repository,
    },
    github.reads
  );
  if (collection.status !== "collected") {
    return {
      ...FRAME,
      // Field by field: only the collector's fixed codes, whatever else a
      // failure may come to hold.
      collection: {
        reason: collection.reason,
        status: collection.status,
        ...("path" in collection ? { path: collection.path } : {}),
      },
      read: github.failure(),
      stage: "collection",
      status: "not-collected",
    };
  }
  // Evidence from a collection whose ledger was not stored must not be
  // evaluated: its bindings and its snapshot would be recorded nowhere.
  const stored = await ledgerStep("ledger-store", () =>
    replaceReviewLedger(location, entry, collection.ledger)
  );
  if (stored !== "stored") {
    return {
      ...FRAME,
      code: "conflict",
      stage: "ledger-store",
      status: "not-collected",
    };
  }
  const { checks, rejected } = normalizeCheckReceipts(receipts, {
    checks: policy.checks,
    provenance: policy.evidence.verification,
    pullRequest,
  });
  const evaluation = evaluateEvidence(
    {
      event: "pull_request",
      pullRequest: { ...collection.evidence, ...reviewEvidence, checks },
      schemaVersion: 2,
    },
    policy.evidence
  );
  if (evaluation.status === "invalid") {
    // Of what the evaluator is given, only the policy's evidence part and the
    // review evidence were not checked here, so its issues are about those.
    return { ...FRAME, issues: evaluation.issues, status: "invalid-input" };
  }
  const { subject } = collection.evidence;
  return {
    ...FRAME,
    eligible: evaluation.eligible,
    evaluation,
    rejectedReceipts: rejected,
    runId,
    status: "evaluated",
    subject: {
      baseSha: subject.baseSha,
      headSha: subject.headSha,
      pullRequest: subject.id,
      repository: subject.repository,
    },
  };
};

/**
 * Answers, for one pull request, whether it passes Forge's six gates. It reads
 * the review ledger, collects the pull request from GitHub, stores the ledger,
 * joins the receipts and review evidence it is given, and evaluates. It reads
 * the clock, the named files and GitHub, and writes only the ledger entry: it
 * posts nothing, merges nothing and enforces nothing.
 *
 * It never rejects. An unexpected failure anywhere is `not-collected` at stage
 * `internal`, with nothing from the failure in the document.
 */
export const runGate = async (
  invocation: GateInvocation
): Promise<GateDocument> => {
  try {
    return await gate(invocation);
  } catch (error) {
    return error instanceof LedgerStoppedError
      ? { ...FRAME, ...error.stop, status: "not-collected" }
      : { ...FRAME, stage: "internal", status: "not-collected" };
  }
};
