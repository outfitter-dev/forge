import type { CodexReviewEvidenceResult } from "./codex-review-evidence-types.ts";
import type { ReviewFindingLedger } from "./evidence-types.ts";
import type { ReviewEvidence } from "./gate-inputs.ts";
import { gateReviewFindings } from "./review-ledger-findings.ts";

/** Absence supplies no extra completeness claim when the collector owns complete history. */
export const gateReviewEvidence = (
  findings: ReviewFindingLedger,
  collected: CodexReviewEvidenceResult | undefined,
  supplied: ReviewEvidence | null
): ReviewEvidence => {
  if (collected !== undefined && supplied === null) {
    return {
      agentReviews: collected.agentReviews,
      reviewFindings: findings,
      reviewLadder: null,
    };
  }
  const external = supplied ?? {
    agentReviews: [],
    reviewFindings: { findings: [], recorded: false },
    reviewLadder: null,
  };
  return {
    agentReviews:
      collected !== undefined && Array.isArray(external.agentReviews)
        ? [...collected.agentReviews, ...external.agentReviews]
        : external.agentReviews,
    reviewFindings: gateReviewFindings(findings, external.reviewFindings),
    reviewLadder: external.reviewLadder,
  };
};
