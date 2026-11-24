import type { ReviewFindingLedger } from "./evidence-types.ts";
import type { ReviewEvidence } from "./gate-inputs.ts";
import type { CollectedReviewEvidence } from "./review-adapter.ts";
import {
  gateReviewFindings,
  parseStoredFindings,
} from "./review-ledger-findings.ts";

/** Absence supplies no extra completeness claim when the collector owns complete history. */
export const gateReviewEvidence = (
  findings: ReviewFindingLedger,
  collected: CollectedReviewEvidence | undefined,
  supplied: ReviewEvidence | null,
  collectorOwnsFindings = false
): ReviewEvidence => {
  if (supplied === null && (collected !== undefined || collectorOwnsFindings)) {
    return {
      agentReviews: collected?.agentReviews ?? [],
      ...(collected?.resolutionReviews === undefined
        ? {}
        : { resolutionReviews: collected.resolutionReviews }),
      reviewFindings: findings,
      reviewLadder: null,
    };
  }
  const external = supplied ?? {
    agentReviews: [],
    reviewFindings: { findings: [], recorded: false },
    reviewLadder: null,
  };
  let reviewFindings = gateReviewFindings(findings, external.reviewFindings);
  if (collected?.reviewFindings.recorded === false) {
    try {
      reviewFindings = {
        ...parseStoredFindings(reviewFindings),
        recorded: false,
      };
    } catch {
      // Preserve malformed supplied evidence for the evaluator's invalid-input response.
    }
  }
  return {
    ...(collected?.resolutionReviews === undefined
      ? {}
      : { resolutionReviews: collected.resolutionReviews }),
    agentReviews:
      collected !== undefined && Array.isArray(external.agentReviews)
        ? [...collected.agentReviews, ...external.agentReviews]
        : external.agentReviews,
    reviewFindings,
    reviewLadder: external.reviewLadder,
  };
};
