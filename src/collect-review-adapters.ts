import { isDeepStrictEqual } from "node:util";

import type {
  PullRequestCommentReads,
  PullRequestReads,
} from "./collect-pull-request-types.ts";
import type { AgentReviewAttempt } from "./evidence-types.ts";
import { invalid } from "./evidence-validation-primitives.ts";
import { GitHubReadError } from "./github-pull-request-reads.ts";
import type { GitHubReadFailure } from "./github-pull-request-reads.ts";
import { GitHubResponseError } from "./parse-github-pull-request.ts";
import { normalizeReviewObservation } from "./review-adapter-normalization.ts";
import { registeredReviewAdapter } from "./review-adapter-registry.ts";
import type {
  ReviewAdapterRegistry,
  ReviewAdapterObservation,
  ReviewCollectionConfiguration,
  ReviewCollectionResult,
  ReviewObservationInput,
  ReviewSourceObservation,
} from "./review-collection-types.ts";
import { parseStoredFindings } from "./review-ledger-findings.ts";

/** Shared pull-request reads keep their own failure path. Only each adapter's extra source is caught here. */
export const observeReviewAdapters = async (
  entries: ReviewCollectionConfiguration[] | undefined,
  reads: PullRequestReads & Partial<PullRequestCommentReads>,
  registry: ReviewAdapterRegistry
): Promise<ReviewSourceObservation[]> => {
  const observations: ReviewSourceObservation[] = [];
  for (const entry of entries ?? []) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Keep configured source order for each collection pass.
      const value = await (
        registeredReviewAdapter(registry, entry.adapter) ??
        invalid("reviewAdapters.adapter", "adapter is not installed")
      ).observe(structuredClone(entry), reads);
      observations.push({ status: "observed", value: structuredClone(value) });
    } catch (error) {
      observations.push(
        error instanceof GitHubResponseError
          ? { read: null, reason: "source-unreadable", status: "unreadable" }
          : {
              read:
                error instanceof GitHubReadError
                  ? { code: error.code, status: error.status }
                  : null,
              reason: "source-unavailable",
              status: "unavailable",
            }
      );
    }
  }
  return observations;
};

/** A sole source's transport failure retains the established retry envelope and precedes every ledger write. */
export const requireSingleReviewSourceRead = (
  sources: ReviewSourceObservation[]
): void => {
  const [source] = sources;
  if (
    sources.length === 1 &&
    source?.status === "unavailable" &&
    source.read !== null
  ) {
    throw new GitHubReadError(source.read.code, source.read.status);
  }
};

const unavailableAttempt = (
  config: ReviewCollectionConfiguration,
  input: ReviewObservationInput
): AgentReviewAttempt => {
  const startedAt = input.snapshot?.observedAt ?? input.servedAt;
  const deadlineAt =
    config.reviewer.rung === "hosted"
      ? new Date(Date.parse(startedAt) + config.reviewer.waitSeconds * 1000)
          .toISOString()
          .replace(".000Z", "Z")
      : null;
  return {
    attemptId: `${config.adapter}/${config.reviewer.reviewer}/${input.subject.headSha}/${input.subject.baseSha}/${startedAt}`,
    complete: false,
    context: "unknown",
    deadlineAt,
    findingIds: null,
    harness: null,
    instructions: null,
    kind: "general-review",
    launch: "unknown",
    model: null,
    nativeRef: null,
    observedAt: input.servedAt,
    provenance: config.issuer,
    reviewer: config.reviewer.reviewer,
    rung: config.reviewer.rung,
    startedAt,
    state: "unavailable",
    subject: input.subject,
    unavailableReason: "error",
    verdict: "unknown",
  };
};

type Normalized =
  | { accepted: true; result: ReviewAdapterObservation }
  | {
      accepted: false;
      state: "unavailable" | "unreadable";
      reason: string;
      read?: { code: GitHubReadFailure; status: number | null } | null;
    };

const normalizeObservation = (
  entry: ReviewCollectionConfiguration,
  before: ReviewSourceObservation | undefined,
  after: ReviewSourceObservation | undefined,
  input: ReviewObservationInput,
  registry: ReviewAdapterRegistry
): Normalized => {
  if (before === undefined || after === undefined) {
    return {
      accepted: false,
      reason: "source-unavailable",
      state: "unavailable",
    };
  }
  if (before.status !== "observed") {
    return {
      accepted: false,
      read: before.read,
      reason: before.reason,
      state: before.status,
    };
  }
  if (after.status !== "observed") {
    return {
      accepted: false,
      read: after.read,
      reason: after.reason,
      state: after.status,
    };
  }
  if (!isDeepStrictEqual(before.value, after.value)) {
    return { accepted: false, reason: "source-changed", state: "unreadable" };
  }
  const result = normalizeReviewObservation(
    entry,
    before.value,
    input,
    registry
  );
  return result === undefined
    ? {
        accepted: false,
        reason: "normalization-unreadable",
        state: "unreadable",
      }
    : { accepted: true, result };
};

/** Normalize every source to retain adverse reports, selecting attempts only until the first terminal result. */
export const collectedReviewAdapters = (
  entries: ReviewCollectionConfiguration[],
  first: ReviewSourceObservation[],
  second: ReviewSourceObservation[],
  input: ReviewObservationInput,
  registry: ReviewAdapterRegistry
): ReviewCollectionResult => {
  let findings = parseStoredFindings(input.findings);
  let complete = entries.length === 0 ? findings.recorded : true;
  let selecting = true;
  const agentReviews: AgentReviewAttempt[] = [];
  const adapters: ReviewCollectionResult["adapters"] = [];
  for (const [index, entry] of entries.entries()) {
    const normalized = normalizeObservation(
      entry,
      first[index],
      second[index],
      { ...input, findings },
      registry
    );
    const selected = selecting;
    if (normalized.accepted) {
      const { result } = normalized;
      findings = result.reviewFindings;
      complete &&= findings.recorded && entry.findingsComplete;
      if (selected) {
        agentReviews.push(...result.agentReviews);
      }
      selecting &&=
        result.state === "unavailable" || result.state === "unreadable";
      adapters.push({
        adapter: entry.adapter,
        diagnostics: result.diagnostics,
        observations: result.observations,
        reviewer: entry.reviewer.reviewer,
        selected,
        state: result.state,
      });
    } else {
      if (normalized.reason !== "normalization-unreadable") {
        const available = [first[index], second[index]]
          .filter((source) => source?.status === "observed")
          .map((source) => source.value);
        if (available.length === 0) {
          available.push(undefined);
        }
        for (const observation of available) {
          const recovered = normalizeReviewObservation(
            { ...entry, findingsComplete: false },
            observation,
            { ...input, findings },
            registry
          );
          if (recovered !== undefined) {
            findings = recovered.reviewFindings;
          }
        }
      }
      complete = false;
      if (selected) {
        agentReviews.push(unavailableAttempt(entry, input));
      }
      adapters.push({
        adapter: entry.adapter,
        diagnostics: [normalized.reason],
        observations:
          normalized.read === undefined ? null : { read: normalized.read },
        reviewer: entry.reviewer.reviewer,
        selected,
        state: normalized.state,
      });
    }
  }
  return {
    adapters,
    agentReviews,
    exhausted: entries.length > 0 && selecting,
    reason:
      entries.length > 0 && selecting ? "review-adapters-exhausted" : null,
    reviewFindings: { findings: findings.findings, recorded: complete },
  };
};
