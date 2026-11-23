import type {
  AgentReviewAttempt,
  PullRequestSubject,
  ReviewFindingLedger,
} from "./evidence-types.ts";
import { invalid } from "./evidence-validation-primitives.ts";
import {
  parseStoredFindings,
  retainsFindings,
} from "./review-ledger-findings.ts";

/** Evaluator facts shared by review collectors. Provider observations stay on the concrete result. */
export interface CollectedReviewEvidence {
  agentReviews: AgentReviewAttempt[];
  reviewFindings: ReviewFindingLedger;
  /** A single adapter cannot attest that the caller exhausted its review ladder. */
  reviewLadder: null;
}

export interface ReviewAdapterInput {
  subject: PullRequestSubject;
  servedAt: string;
  findings: ReviewFindingLedger;
}

/** Normalize already stable observations. Reading sources and executing reviewers belong to callers. */
export interface ReviewAdapter<Result extends CollectedReviewEvidence> {
  collect: (input: ReviewAdapterInput) => Result;
}

/** An adapter can update resolutions, but switching collectors cannot erase accepted findings. */
export const collectReviewAdapter = <Result extends CollectedReviewEvidence>(
  adapter: ReviewAdapter<Result>,
  input: ReviewAdapterInput
): Result => {
  const before = parseStoredFindings(input.findings);
  const result = adapter.collect(structuredClone(input));
  const after = parseStoredFindings(result.reviewFindings);
  if (!retainsFindings(before, after)) {
    invalid("reviewFindings", "review adapter discarded an accepted finding");
  }
  return { ...result, reviewFindings: after };
};
