export const VERIFICATION_GATES = ["lint", "test", "build"] as const;
export const GATE_NAMES = [
  ...VERIFICATION_GATES,
  "agent-review",
  "human-review",
  "mergeability",
] as const;

export type VerificationGate = (typeof VERIFICATION_GATES)[number];
export type GateName = (typeof GATE_NAMES)[number];
export type AgentProvider = "self-hosted" | "devin";

export interface Revision {
  repository: string;
  headSha: string;
  baseSha: string;
}

export interface PullRequestSubject extends Revision {
  kind: "pull_request";
  id: number;
}

export interface MergeGroupSubject extends Revision {
  kind: "merge_group";
}

export type Subject = PullRequestSubject | MergeGroupSubject;

/** Comparisons validate claims; a trusted collector must authenticate producers. */
export interface ProducerPolicy {
  producer: string;
  runtimeFingerprint: string;
}

export interface Provenance extends ProducerPolicy {
  runId: string;
}

export interface AgentPolicy extends ProducerPolicy {
  provider: AgentProvider;
}

/** Policy fields whose meaning is the same in every schema version. */
export interface EvidencePolicyBase {
  repository: string;
  collector: ProducerPolicy;
  verification: ProducerPolicy;
}

/** Schema version 1: every listed provider must supply a passing review. */
export interface EvidencePolicy extends EvidencePolicyBase {
  schemaVersion: 1;
  requiredAgentProviders: AgentPolicy[];
}

/** Fixed review guidance identity. A digest in a receipt is a compared claim. */
export interface ReviewInstructions {
  id: string;
  digest: string;
}

/** An eligible reviewer and the expected issuer of its receipts. Not a requirement. */
export type ReviewerPolicy = ProducerPolicy & { reviewer: string } & (
    | { rung: "hosted"; waitSeconds: number }
    | { rung: "local" }
  );

export interface AgentReviewPolicy {
  reviewers: ReviewerPolicy[];
  /** Trusted fixed guidance a local reviewer may be launched with. */
  instructions: ReviewInstructions[];
  /** Expected issuer of a ladder exhaustion attestation. */
  ladder: ProducerPolicy;
}

/** Schema version 2: any acceptable reviewer may supply the clean review. */
export interface EvidencePolicyV2 extends EvidencePolicyBase {
  schemaVersion: 2;
  agentReview: AgentReviewPolicy;
}

export type CheckState =
  | "passed"
  | "pending"
  | "failed"
  | "canceled"
  | "skipped"
  | "incomplete"
  | "unknown";

export interface CheckEvidence {
  name: VerificationGate;
  subject: Subject;
  provenance: Provenance;
  state: CheckState;
}

export interface AgentReviewEvidence {
  provider: AgentProvider;
  subject: PullRequestSubject;
  provenance: Provenance;
  state: "completed" | "pending" | "failed" | "canceled" | "unavailable";
  complete: boolean;
  verdict: "passed" | "failed" | "unknown";
  blockingFindings: number | null;
}

export interface HumanReviewEvidence {
  reviewer: string;
  subject: PullRequestSubject | null;
  state:
    | "approved"
    | "changes_requested"
    | "dismissed"
    | "commented"
    | "pending";
}

/**
 * One started general-review attempt. Launch, context, model, harness, and
 * instructions are attested claims; this shape cannot prove any of them.
 */
export interface AgentReviewAttempt {
  kind: "general-review";
  attemptId: string;
  rung: ReviewerPolicy["rung"];
  reviewer: string;
  subject: PullRequestSubject;
  provenance: Provenance;
  model: string | null;
  harness: string | null;
  instructions: ReviewInstructions | null;
  launch: "separate-invocation" | "author-subagent" | "unknown";
  context: "none" | "inherited" | "unknown";
  /** Whole-second UTC start of the trusted observation window; polls keep it. */
  startedAt: string;
  deadlineAt: string | null;
  observedAt: string;
  state: AgentReviewEvidence["state"];
  unavailableReason: "rate-limit" | "error" | "timeout" | "unknown" | null;
  complete: boolean;
  verdict: AgentReviewEvidence["verdict"];
  /** Ledger finding IDs this attempt reported; `null` means unknown, not none. */
  findingIds: string[] | null;
  nativeRef: string | null;
}

/** The only two ways a ledger entry stops blocking. */
export type FindingResolution =
  | {
      /** Provider-native resolution a trusted collector observed for a hosted reviewer. */
      kind: "native";
      provenance: Provenance;
      nativeRef: string;
    }
  | {
      /** An independent complete follow-up review that explicitly addressed the entry. */
      kind: "follow-up-review";
      subject: PullRequestSubject;
      attemptId: string;
      disposition: "fixed" | "dismissed";
      provenance: Provenance;
      nativeRef: string;
    };

/**
 * A reported blocker, identified by reviewer and that reviewer's native ID.
 * `adverse-review` is a failed verdict whose details were not available.
 */
export interface ReviewFinding {
  kind: "finding" | "adverse-review";
  reviewer: string;
  id: string;
  /** The attempt that first reported it; that attempt can never resolve it. */
  attemptId: string;
  nativeRef: string;
  resolution: FindingResolution | null;
}

/**
 * Persisted for the PR across attempts and revisions; absence is not resolution.
 * `recorded` is the trusted collector's completeness attestation, not proof.
 */
export interface ReviewFindingLedger {
  recorded: boolean;
  findings: ReviewFinding[];
}

/** The ladder runner's revision-bound claim about its own run. */
export interface ReviewLadder {
  subject: PullRequestSubject;
  provenance: Provenance;
  exhausted: boolean;
}

export interface PullRequestEvidenceOf<Review> {
  subject: PullRequestSubject;
  provenance: Provenance;
  checks: CheckEvidence[];
  agentReviews: Review[];
  assignments: { recorded: boolean; requiredReviewers: string[] };
  humanReviews: HumanReviewEvidence[];
  open: boolean | null;
  draft: boolean | null;
  mergeable: boolean | null;
  mergeAuthorized: boolean | null;
  unresolvedThreads: number | null;
}

export type PullRequestEvidence = PullRequestEvidenceOf<AgentReviewEvidence>;

export interface PullRequestEvidenceV2 extends PullRequestEvidenceOf<AgentReviewAttempt> {
  reviewFindings: ReviewFindingLedger;
  reviewLadder: ReviewLadder | null;
}

export interface ModelAssessment {
  verdict: "pass" | "block";
  explanation: string;
}

interface FactsBase<Version> {
  schemaVersion: Version;
  modelAssessment?: ModelAssessment;
}

export interface PullRequestFactsOf<Version, Pr> extends FactsBase<Version> {
  event: "pull_request";
  pullRequest: Pr;
}

export interface MergeGroupFactsOf<Version, Pr> extends FactsBase<Version> {
  event: "merge_group";
  candidate: {
    subject: MergeGroupSubject;
    provenance: Provenance;
    checks: CheckEvidence[];
  };
  /** Authoritative current membership, independently bound from saved admissions. */
  members: PullRequestSubject[];
  admissions: Pr[];
}

export type EvidenceFactsOf<Version, Pr> =
  | PullRequestFactsOf<Version, Pr>
  | MergeGroupFactsOf<Version, Pr>;

export type PullRequestFacts = PullRequestFactsOf<1, PullRequestEvidence>;
export type MergeGroupFacts = MergeGroupFactsOf<1, PullRequestEvidence>;
export type EvidenceFacts = PullRequestFacts | MergeGroupFacts;
export interface EvidenceInput {
  facts: EvidenceFacts;
  policy: EvidencePolicy;
}

export type PullRequestFactsV2 = PullRequestFactsOf<2, PullRequestEvidenceV2>;
export type MergeGroupFactsV2 = MergeGroupFactsOf<2, PullRequestEvidenceV2>;
export type EvidenceFactsV2 = PullRequestFactsV2 | MergeGroupFactsV2;
/** Facts and policy always share one schema version. */
export interface EvidenceInputV2 {
  facts: EvidenceFactsV2;
  policy: EvidencePolicyV2;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; input: EvidenceInput | EvidenceInputV2 }
  | { valid: false; issues: ValidationIssue[] };

export type ReasonCode =
  | "repository-mismatch"
  | "subject-mismatch"
  | "producer-mismatch"
  | "runtime-mismatch"
  | "missing-evidence"
  | "duplicate-evidence"
  | "check-not-passed"
  | "review-incomplete"
  | "blocking-findings"
  | "findings-unknown"
  | "reviewer-not-acceptable"
  | "review-unavailable"
  | "review-pending"
  | "review-not-independent"
  | "instructions-untrusted"
  | "deadline-mismatch"
  | "ladder-exhausted"
  | "assignments-unknown"
  | "approval-required"
  | "changes-requested"
  | "landing-blocked"
  | "membership-mismatch"
  | "gate-blocked";

export interface GateReason {
  code: ReasonCode;
  path: string;
  message: string;
}

export interface GateDecision {
  name: GateName;
  conclusion: "success" | "failure";
  reasons: GateReason[];
}

/** Why one PR's agent review stands where it does. The gate stays authoritative. */
export interface AgentReviewOutcome {
  pullRequest: number;
  /** `needs_human` is a failure a caller can route; it never passes the gate. */
  disposition: "satisfied" | "blocked" | "needs_human";
  /** Attempt IDs that meet every acceptable-review requirement. */
  satisfiedBy: string[];
}

interface Evaluated {
  status: "evaluated";
  eligible: boolean;
  gates: GateDecision[];
  modelAssessment: {
    authority: "advisory";
    assessment: ModelAssessment | null;
  };
}

export type EvaluationResult =
  | {
      status: "invalid";
      eligible: false;
      issues: ValidationIssue[];
    }
  | (Evaluated & {
      schemaVersion: 1;
      /** Detached snapshot of the exact normalized evidence and policy evaluated. */
      input: EvidenceInput;
    })
  | (Evaluated & {
      schemaVersion: 2;
      input: EvidenceInputV2;
      /** One entry per evaluated PR, in input order. */
      agentReview: AgentReviewOutcome[];
    });
