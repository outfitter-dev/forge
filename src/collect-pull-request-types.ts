import type { Provenance, PullRequestEvidenceOf } from "./evidence-types.ts";
import type { ReviewLedgerEntry } from "./review-ledger.ts";

/**
 * The reads of one pull request, already bound to its repository and number by
 * whoever constructs them. Each call is a fresh read of GitHub.
 */
export interface PullRequestReads {
  /** One read of the pull request. `servedAt` is GitHub's `Date` header for that response as a whole-second UTC time. */
  pullRequest: () => Promise<{ body: unknown; servedAt: string }>;
  /** The whole timeline: every page, in order. */
  timeline: () => Promise<unknown>;
  /** Every review: every page, in order. */
  reviews: () => Promise<unknown>;
  /** One page of the review-thread connection, starting after `cursor` (null for the first page). */
  reviewThreads: (cursor: string | null) => Promise<unknown>;
}

export interface PullRequestCollectionRequest {
  /** `owner/name`, as policy names it. The evidence subject carries it as given. */
  repository: string;
  pullRequest: number;
  /** The label that withholds landing; for Forge, `forge:hold`. Printable ASCII, matched without regard to the case of `A` to `Z`. */
  holdLabel: string;
  /** The collector's own identity, copied onto the evidence. */
  provenance: Provenance;
  /** The entry the last accepted collection returned, or an empty one. */
  ledger: ReviewLedgerEntry;
  /** The most review-thread pages one pass may read. */
  maxThreadPages: number;
}

/** The pull-request evidence this operation supplies; other operations supply the rest. */
export type CollectedPullRequestEvidence = Pick<
  PullRequestEvidenceOf<never>,
  | "subject"
  | "provenance"
  | "assignments"
  | "humanReviews"
  | "open"
  | "draft"
  | "mergeable"
  | "mergeAuthorized"
  | "unresolvedThreads"
>;

/**
 * Why a collection produced no evidence. Each is a fixed code; `path` names a
 * field and never holds its value. No failure carries a ledger: the persisted
 * entry stays as it was.
 */
export type PullRequestCollectionFailure =
  | {
      status: "changed";
      reason:
        | "pull-request-changed"
        | "reviews-changed"
        | "timeline-changed"
        | "threads-changed";
    }
  | {
      status: "unreadable";
      reason:
        | "response-unreadable"
        | "served-at-unreadable"
        | "served-at-regressed";
      path: string;
    }
  | { status: "ambiguous"; reason: "review-history-ambiguous" }
  | { status: "unavailable"; reason: "read-failed" | "thread-pages-exceeded" }
  | {
      status: "mismatch";
      reason: "repository-mismatch" | "pull-request-mismatch";
    }
  | { status: "invalid-request"; reason: "request-malformed" };

export type PullRequestCollectionResult =
  | {
      status: "collected";
      evidence: CollectedPullRequestEvidence;
      /** The entry to persist in place of the one in the request. */
      ledger: ReviewLedgerEntry;
    }
  | PullRequestCollectionFailure;
