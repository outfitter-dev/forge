import type { PullRequestCollectionFailure } from "./collect-pull-request-types.ts";
import type { EvaluationResult, ValidationIssue } from "./evidence-types.ts";
import type { GitHubReadFailure } from "./github-pull-request-reads.ts";
import type { CheckReceiptNormalization } from "./normalize-check-receipts.ts";
import type { ReviewLedgerErrorCode } from "./review-ledger-entry.ts";

/** The pull request was judged. `eligible` is the answer; `evaluation` is why. */
export interface GateEvaluated {
  status: "evaluated";
  eligible: boolean;
  /** The revision judged, as collected from GitHub. */
  subject: {
    repository: string;
    pullRequest: number;
    headSha: string;
    baseSha: string;
  };
  /** The invoker's identifier for this run. */
  runId: string;
  /** Receipts that produced no evidence. `index` is the position of the `--receipt` flag. */
  rejectedReceipts: CheckReceiptNormalization["rejected"];
  /** The evaluator's result, unchanged: six gate decisions and the input it evaluated. */
  evaluation: Extract<EvaluationResult, { status: "evaluated" }>;
}

/** A ledger stage stopped the run. `conflict`: another collection stored an entry in between. */
export interface GateLedgerStop {
  stage: "ledger-read" | "ledger-store";
  code: ReviewLedgerErrorCode | "conflict";
}

/**
 * The pull request was not judged, and why, as fixed codes only: never a
 * message from an underlying error and never a path on disk.
 */
export type GateNotCollected = { status: "not-collected" } & (
  | GateLedgerStop
  | {
      stage: "collection";
      /** The collector's own status and reason. `path` names a response field, never its value. */
      collection: {
        status: PullRequestCollectionFailure["status"];
        reason: PullRequestCollectionFailure["reason"];
        path?: string;
      };
      /** The first failure a read threw, as the transport's code and HTTP status. */
      read: { code: GitHubReadFailure; status: number | null } | null;
    }
  /** An unexpected failure. Nothing of it is reported. */
  | { stage: "internal" }
);

/** What was given could not be used. `usage` is present when the arguments were wrong. */
export interface GateInvalidInput {
  status: "invalid-input";
  /** Each names an argument, a variable, a file or a field, and never holds a value. */
  issues: ValidationIssue[];
  usage?: string;
}

/**
 * The one JSON document `forge gate` writes to stdout. `evaluated` is the only
 * status that judges the pull request; the other two say why it was not judged.
 */
export type GateDocument = { kind: "forge-gate"; schemaVersion: 1 } & (
  | GateEvaluated
  | GateNotCollected
  | GateInvalidInput
);

/** 0 only for an evaluated, eligible pull request. Not collected is never 0 or 1. */
export const gateExitCode = (document: GateDocument): 0 | 1 | 2 | 3 => {
  if (document.status === "evaluated") {
    return document.eligible ? 0 : 1;
  }
  return document.status === "invalid-input" ? 2 : 3;
};
