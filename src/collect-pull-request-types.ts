import type {
  CodexReviewConfiguration,
  CodexReviewEvidenceResult,
} from "./codex-review-evidence-types.ts";
import type { Provenance, PullRequestEvidenceOf } from "./evidence-types.ts";
import type { GitHubReviewThread } from "./github-pull-request-types.ts";
import type {
  CanonicalReviewLedgerEntry,
  ReviewLedgerEntry,
} from "./review-ledger.ts";

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

/** Optional capability for hosted review collection. Existing pull-request readers need not implement it. */
export interface PullRequestCommentReads {
  /** One page of the issue-comment connection, starting after cursor (null for the first page). */
  issueComments: (cursor: string | null) => Promise<unknown>;
}

/** Explicit optional collector capability. It does not adopt a gate policy. */
export interface PullRequestCodexReviewConfig extends CodexReviewConfiguration {
  maxCommentPages: number;
  /** Explicit caller claim that all owned reporting history is covered. Missing stays unknown. */
  findingsComplete?: boolean;
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
  codexReview?: PullRequestCodexReviewConfig;
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
        | "threads-changed"
        | "comments-changed";
    }
  | {
      status: "unreadable";
      reason:
        | "response-unreadable"
        | "served-at-unreadable"
        | "served-at-regressed"
        | "codex-evidence-unreadable";
      path: string;
    }
  | { status: "ambiguous"; reason: "review-history-ambiguous" }
  | {
      status: "unavailable";
      reason:
        | "read-failed"
        | "thread-pages-exceeded"
        | "comment-pages-exceeded"
        | "comment-read-missing";
    }
  | {
      status: "mismatch";
      reason: "repository-mismatch" | "pull-request-mismatch";
    }
  | { status: "invalid-request"; reason: "request-malformed" };

export type PullRequestCollectionResult =
  | {
      status: "collected";
      /** Present only when explicitly configured. Outside minimal evaluator facts. */
      codexReview?: CodexReviewEvidenceResult;
      evidence: CollectedPullRequestEvidence;
      /** Stable full-list source observations, outside evaluator facts. */
      reviewThreads: GitHubReviewThread[];
      /** The entry to persist in place of the one in the request. */
      ledger: CanonicalReviewLedgerEntry;
    }
  | PullRequestCollectionFailure;
