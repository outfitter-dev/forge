import {
  collectedCodexReview,
  legacyReviewConfiguration,
} from "./collect-codex-review.ts";
import type { CompatiblePullRequestCollectionRequest } from "./collect-pull-request-types.ts";
import { collectedReviewAdapters } from "./collect-review-adapters.ts";
import type { PullRequestSubject } from "./evidence-types.ts";
import type {
  GitHubIssueComment,
  GitHubReviewThread,
} from "./github-pull-request-types.ts";
import type {
  ReviewAdapterRegistry,
  ReviewSourceObservation,
} from "./review-collection-types.ts";
import type { CanonicalReviewLedgerEntry } from "./review-ledger.ts";

/** Explicitly preserve the legacy collector API while the gate uses neutral adapter results. */
export const collectedPullRequestReviews = (
  request: CompatiblePullRequestCollectionRequest,
  sources: {
    comments: GitHubIssueComment[] | null;
    first: ReviewSourceObservation[];
    second: ReviewSourceObservation[];
  },
  input: {
    subject: PullRequestSubject;
    servedAt: string;
    ledger: CanonicalReviewLedgerEntry;
    reviewThreads: GitHubReviewThread[];
  },
  registry: ReviewAdapterRegistry
) => {
  if (request.reviewAdapters === undefined) {
    const codexReview = collectedCodexReview(
      legacyReviewConfiguration(request),
      sources.comments,
      input
    );
    if (codexReview !== undefined) {
      input.ledger.reviewFindings = structuredClone(codexReview.reviewFindings);
    }
    return codexReview === undefined ? {} : { codexReview };
  }
  const reviewAdapters = collectedReviewAdapters(
    request.reviewAdapters,
    sources.first,
    sources.second,
    {
      findings: input.ledger.reviewFindings,
      reviewThreads: input.reviewThreads,
      servedAt: input.servedAt,
      snapshot: input.ledger.observedRevision,
      subject: input.subject,
    },
    registry
  );
  input.ledger.reviewFindings = structuredClone(reviewAdapters.reviewFindings);
  return { reviewAdapters };
};
