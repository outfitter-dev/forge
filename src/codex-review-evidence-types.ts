import type { CodexSummaryObservation } from "./codex-summary.ts";
import type {
  AgentReviewAttempt,
  Provenance,
  PullRequestSubject,
  ReviewerPolicy,
  ReviewFindingLedger,
} from "./evidence-types.ts";
import type {
  GitHubIssueComment,
  GitHubReviewThread,
} from "./github-pull-request-types.ts";
import type { ObservedRevision } from "./review-ledger.ts";

/** An explicit trusted-policy claim. The pure operation cannot authenticate its source. */
export interface CodexIndependenceAttestation {
  id: string;
  policyRevision: string;
  repository: string;
  reviewer: string;
  botAccountId: number;
}

export interface CodexReviewEvidenceInput {
  subject: PullRequestSubject;
  /** The first pull request read's servedAt from the stable collection. */
  servedAt: string;
  /**
   * The effective snapshot returned by nextSnapshot using persisted history and
   * the complete base-change timeline. Null cannot establish review binding.
   */
  snapshot: ObservedRevision | null;
  summary: CodexSummaryObservation;
  /** All threads, including earlier heads, after complete two-pass collection. */
  threads: readonly GitHubReviewThread[];
  findings: ReviewFindingLedger;
  /**
   * Explicit caller attestation that all reporting sources it owns were fully
   * collected and prior accepted findings retained. Absent or false stays unknown.
   */
  findingsComplete?: boolean;
  reviewer: Extract<ReviewerPolicy, { rung: "hosted" }>;
  issuer: Provenance;
  botAccountId: number;
  attestation: CodexIndependenceAttestation | null;
}

export type CodexReviewDiagnostic =
  | "snapshot-missing"
  | "snapshot-mismatch"
  | "summary-unavailable"
  | "summary-stale"
  | "summary-unbound"
  | "summary-not-completed"
  | "security-state-unsupported"
  | "independence-unattested"
  | "summary-thread-conflict"
  | "unaccounted-adverse-report";

export type CodexSummaryRecord = Pick<
  CodexSummaryObservation,
  "status" | "reason" | "state" | "cleanCandidate" | "reportedAdverse"
> & {
  comment: Omit<GitHubIssueComment, "body"> | null;
  adverseComments: Omit<GitHubIssueComment, "body">[];
};

export interface CodexReviewEvidenceResult {
  agentReviews: [AgentReviewAttempt];
  reviewFindings: ReviewFindingLedger;
  reviewLadder: null;
  diagnostics: CodexReviewDiagnostic[];
  /** Retained outside evaluator facts to explain attested context and source binding. */
  observations: {
    attestation: CodexIndependenceAttestation | null;
    snapshot: ObservedRevision | null;
    summary: CodexSummaryRecord;
    threads: GitHubReviewThread[];
  };
}
