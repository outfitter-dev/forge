import { isDeepStrictEqual } from "node:util";

import type {
  AgentReviewAttempt,
  PullRequestSubject,
  ReviewFindingLedger,
} from "./evidence-types.ts";
import { invalid, object, text } from "./evidence-validation-primitives.ts";
import {
  parseStoredFindings,
  retainsFindings,
} from "./review-ledger-findings.ts";

/** Plain enumerable data shared by review collectors. Provider observations stay on the concrete result. */
export interface CollectedReviewEvidence {
  resolutionReviews?: AgentReviewAttempt[];
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
  /** The eligible reviewer whose source observations this adapter normalizes. */
  reviewer: string;
  collect: (input: ReviewAdapterInput) => Result;
}

/** An adapter can update resolutions, but switching collectors cannot erase accepted findings. */
export const collectReviewAdapter = <Result extends CollectedReviewEvidence>(
  adapter: ReviewAdapter<Result>,
  input: ReviewAdapterInput
): Result => {
  const reviewer = text(adapter.reviewer, "reviewAdapter.reviewer");
  const before = parseStoredFindings(input.findings);
  const result = adapter.collect(structuredClone(input));
  object(result, "reviewAdapter.result", Object.keys(result));
  if (
    Reflect.ownKeys(result).length !== Object.keys(result).length ||
    Object.values(Object.getOwnPropertyDescriptors(result)).some(
      (descriptor) => !Object.hasOwn(descriptor, "value")
    )
  ) {
    invalid("reviewAdapter.result", "expected enumerable data fields");
  }
  const after = parseStoredFindings(result.reviewFindings);
  if (!retainsFindings(before, after)) {
    invalid("reviewFindings", "review adapter discarded an accepted finding");
  }
  const foreignBefore = before.findings.filter(
    (finding) => finding.reviewer !== reviewer
  );
  const foreignAfter = after.findings.filter(
    (finding) => finding.reviewer !== reviewer
  );
  if (
    foreignBefore.length !== foreignAfter.length ||
    !foreignBefore.every((finding) =>
      foreignAfter.some((next) => isDeepStrictEqual(finding, next))
    )
  ) {
    invalid(
      "reviewFindings",
      "review adapter changed another reviewer's findings"
    );
  }
  if (result.agentReviews.some((attempt) => attempt.reviewer !== reviewer)) {
    invalid(
      "agentReviews",
      "review adapter reported another reviewer's attempt"
    );
  }
  return { ...result, reviewFindings: after };
};
