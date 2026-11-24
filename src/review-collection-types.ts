import type {
  PullRequestCommentReads,
  PullRequestReads,
} from "./collect-pull-request-types.ts";
import type {
  AgentReviewAttempt,
  Provenance,
  ReviewerPolicy,
  ReviewFindingLedger,
} from "./evidence-types.ts";
import type { GatePolicy } from "./gate-policy.ts";
import type { GitHubReadFailure } from "./github-pull-request-reads.ts";
import type { GitHubReviewThread } from "./github-pull-request-types.ts";
import type {
  CollectedReviewEvidence,
  ReviewAdapterInput,
} from "./review-adapter.ts";
import type { ObservedRevision } from "./review-ledger.ts";

export interface ReviewCollectionConfiguration {
  adapter: string;
  reviewer: ReviewerPolicy;
  issuer: Provenance;
  configuration: unknown;
  findingsComplete: boolean;
}

export interface GateReviewAdapterPolicy {
  adapter: string;
  reviewer: string;
  configuration: unknown;
}

export interface ReviewObservationInput extends ReviewAdapterInput {
  snapshot: ObservedRevision | null;
  reviewThreads: GitHubReviewThread[];
}

export type ReviewCollectionState =
  | "passed"
  | "failed"
  | "pending"
  | "unavailable"
  | "unreadable";

export interface ReviewAdapterObservation extends CollectedReviewEvidence {
  /** Explicit links emitted by a trusted installed adapter after qualifying a follow-up report. */
  followUpResolutions?: ReviewFollowUpResolution[];
  state: ReviewCollectionState;
  diagnostics: string[];
  observations: unknown;
}

export interface ReviewFollowUpResolution {
  finding: {
    reviewer: string;
    id: string;
    attemptId: string;
    nativeRef: string;
  };
  attemptId: string;
  disposition: "fixed" | "dismissed";
  nativeRef: string;
}

export interface ReviewAdapterDefinition {
  parsePolicy: (
    value: unknown,
    reviewer: string,
    evidence: GatePolicy["evidence"],
    path: string
  ) => unknown;
  configure: (
    entry: GateReviewAdapterPolicy,
    evidence: GatePolicy["evidence"],
    runId: string,
    maxPages: number,
    supplied: ReviewFindingLedger | null
  ) => ReviewCollectionConfiguration;
  validate: (config: ReviewCollectionConfiguration) => void;
  observe: (
    config: ReviewCollectionConfiguration,
    reads: PullRequestReads & Partial<PullRequestCommentReads>
  ) => Promise<unknown>;
  normalize: (
    config: ReviewCollectionConfiguration,
    observation: unknown,
    input: ReviewObservationInput
  ) => ReviewAdapterObservation;
}

export type ReviewAdapterRegistry = Readonly<
  Record<string, ReviewAdapterDefinition>
>;

export type ReviewSourceObservation =
  | { status: "observed"; value: unknown }
  | {
      status: "unavailable" | "unreadable";
      reason: "source-unavailable" | "source-unreadable";
      read: { code: GitHubReadFailure; status: number | null } | null;
    };

export interface ReviewCollectionResult {
  /** Trusted normalized links from stable sources, applied after native inventory reconciliation. */
  followUpResolutions?: {
    entry: ReviewCollectionConfiguration;
    agentReviews: AgentReviewAttempt[];
    links: ReviewFollowUpResolution[];
    state: ReviewCollectionState;
    selected: boolean;
  }[];
  agentReviews: AgentReviewAttempt[];
  resolutionReviews?: AgentReviewAttempt[];
  reviewFindings: ReviewFindingLedger;
  /** Describes these configured adapters only. Forge never claims that Ranger exhausted its execution ladder. */
  exhausted: boolean;
  reason: "review-adapters-exhausted" | null;
  adapters: {
    adapter: string;
    reviewer: string;
    state: ReviewCollectionState;
    selected: boolean;
    diagnostics: string[];
    observations: unknown;
  }[];
}
