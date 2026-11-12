import type { CheckReceipt, CheckSource } from "./check-types.ts";
import type {
  CheckEvidence,
  CheckState,
  ProducerPolicy,
  VerificationGate,
} from "./evidence-types.ts";
import { VERIFICATION_GATES } from "./evidence-types.ts";

/**
 * A trusted caller's expectation, never read from the proposed checkout:
 * proposed code cannot choose which of its checks satisfies a gate.
 */
export interface CheckReceiptExpectation {
  /** The PR the caller collected these receipts for. */
  pullRequest: number;
  /** The declared check ID that satisfies each verification gate. */
  checks: Record<VerificationGate, string>;
  /** The verification producer and runtime the caller vouches for. */
  provenance: ProducerPolicy;
}

/** Why a receipt produced no evidence. */
export type CheckReceiptRejectionCode =
  | "malformed-receipt"
  | "repository-missing"
  | "repository-invalid"
  | "check-unmapped"
  | "source-missing"
  | "head-invalid"
  | "base-missing"
  | "base-invalid";

export interface CheckReceiptNormalization {
  checks: CheckEvidence[];
  /** `index` is the receipt's position in the supplied list. */
  rejected: { index: number; code: CheckReceiptRejectionCode }[];
}

const SOURCE_IDENTITY = [
  "head",
  "tree",
  "base",
  "worktreeDigest",
  "indexDigest",
] as const;

type Source = Pick<
  CheckSource,
  (typeof SOURCE_IDENTITY)[number] | "dirty" | "untracked"
>;

/** The receipt fields this operation reads; the rest are not validated here. */
type Receipt = Pick<
  CheckReceipt,
  | "admission"
  | "cancellation"
  | "completion"
  | "evidence"
  | "exitCode"
  | "finishedAt"
  | "outcome"
  | "receiptId"
  | "repository"
> & {
  check: Pick<NonNullable<CheckReceipt["check"]>, "id"> | null;
  recording: Pick<CheckReceipt["recording"], "state">;
  sourceAfter: Source | null;
  sourceBefore: Source | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === "string" && value !== "";
/** The evaluator rejects a whole evaluation over an untrimmed identifier. */
const isTrimmedText = (value: unknown): value is string =>
  isText(value) && value.trim() === value;
const isRepository = (value: string) => /^[\w.-]+\/[\w.-]+$/u.test(value);
const isNullOr = (value: unknown, check: (item: unknown) => boolean) =>
  value === null || check(value);
const isOneOf = (value: unknown, choices: unknown[]) => choices.includes(value);
const isCommit = (value: unknown) =>
  typeof value === "string" && /^[\da-f]{40}$/u.test(value);

const isSource = (value: unknown): value is Source =>
  isRecord(value) &&
  isText(value.head) &&
  isText(value.tree) &&
  isNullOr(value.base, isText) &&
  isText(value.worktreeDigest) &&
  isText(value.indexDigest) &&
  typeof value.dirty === "boolean" &&
  typeof value.untracked === "number";

const isReceipt = (value: unknown): value is Receipt =>
  isRecord(value) &&
  value.kind === "forge-check" &&
  value.schemaVersion === 1 &&
  isTrimmedText(value.receiptId) &&
  isRecord(value.recording) &&
  isOneOf(value.recording.state, ["persisted", "failed"]) &&
  isNullOr(value.repository, isText) &&
  isNullOr(value.check, (item) => isRecord(item) && isText(item.id)) &&
  isNullOr(value.sourceBefore, isSource) &&
  isNullOr(value.sourceAfter, isSource) &&
  isNullOr(value.finishedAt, isText) &&
  isOneOf(value.admission, ["not-started", "started", "unknown"]) &&
  isOneOf(value.completion, ["observed", "unknown"]) &&
  isOneOf(value.outcome, [
    "passed",
    "failed",
    "canceled",
    "not-run",
    "unknown",
  ]) &&
  isNullOr(value.exitCode, (item) => typeof item === "number") &&
  isOneOf(value.cancellation, ["SIGINT", "SIGTERM", null]) &&
  isOneOf(value.evidence, ["stable", "changed", "unknown"]);

/** `passed` needs every observation; anything less keeps its weaker meaning. */
const stateOf = (
  receipt: Receipt,
  before: Source,
  after: Source
): CheckState => {
  if (
    receipt.recording.state === "persisted" &&
    receipt.admission === "started" &&
    receipt.completion === "observed" &&
    receipt.outcome === "passed" &&
    receipt.exitCode === 0 &&
    receipt.evidence === "stable" &&
    receipt.cancellation === null &&
    receipt.finishedAt !== null &&
    SOURCE_IDENTITY.every((key) => before[key] === after[key]) &&
    // A dirty tree means the checked bytes are not the commit's.
    !after.dirty &&
    after.untracked === 0
  ) {
    return "passed";
  }
  if (receipt.completion === "unknown" || receipt.outcome === "unknown") {
    return "unknown";
  }
  if (receipt.outcome === "canceled" || receipt.outcome === "failed") {
    return receipt.outcome;
  }
  return "incomplete";
};

const normalize = (
  receipt: unknown,
  expectation: CheckReceiptExpectation
): CheckEvidence[] | CheckReceiptRejectionCode => {
  if (!isReceipt(receipt)) {
    return "malformed-receipt";
  }
  const { check, receiptId, repository, sourceAfter, sourceBefore } = receipt;
  if (repository === null) {
    return "repository-missing";
  }
  if (!isRepository(repository)) {
    return "repository-invalid";
  }
  const gates = VERIFICATION_GATES.filter(
    (gate) => expectation.checks[gate] === check?.id
  );
  if (check === null || gates.length === 0) {
    return "check-unmapped";
  }
  if (sourceBefore === null || sourceAfter === null) {
    return "source-missing";
  }
  const { base, head } = sourceAfter;
  if (!isCommit(head)) {
    return "head-invalid";
  }
  if (base === null) {
    return "base-missing";
  }
  if (!isCommit(base)) {
    return "base-invalid";
  }
  const state = stateOf(receipt, sourceBefore, sourceAfter);
  // The subject is the receipt's own, so the evaluator catches a stale or
  // foreign receipt instead of this step relabelling it as current.
  return gates.map((name) => ({
    name,
    provenance: { ...expectation.provenance, runId: receiptId },
    state,
    subject: {
      baseSha: base,
      headSha: head,
      id: expectation.pullRequest,
      kind: "pull_request",
      repository,
    },
  }));
};

/**
 * Derives verification gate evidence from `forge check` receipts. Pure: it
 * validates receipt shape but does not authenticate who produced a receipt.
 * Duplicates pass through so the evaluator can block on them.
 */
export const normalizeCheckReceipts = (
  receipts: unknown[],
  expectation: CheckReceiptExpectation
): CheckReceiptNormalization => {
  const result: CheckReceiptNormalization = { checks: [], rejected: [] };
  for (const [index, receipt] of receipts.entries()) {
    const outcome = normalize(receipt, expectation);
    if (typeof outcome === "string") {
      result.rejected.push({ code: outcome, index });
    } else {
      result.checks.push(...outcome);
    }
  }
  return result;
};
