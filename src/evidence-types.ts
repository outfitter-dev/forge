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

export interface EvidencePolicy {
  schemaVersion: 1;
  repository: string;
  collector: ProducerPolicy;
  verification: ProducerPolicy;
  requiredAgentProviders: AgentPolicy[];
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

export interface PullRequestEvidence {
  subject: PullRequestSubject;
  provenance: Provenance;
  checks: CheckEvidence[];
  agentReviews: AgentReviewEvidence[];
  assignments: { recorded: boolean; requiredReviewers: string[] };
  humanReviews: HumanReviewEvidence[];
  open: boolean | null;
  draft: boolean | null;
  mergeable: boolean | null;
  mergeAuthorized: boolean | null;
  unresolvedThreads: number | null;
}

export interface ModelAssessment {
  verdict: "pass" | "block";
  explanation: string;
}

interface FactsBase {
  schemaVersion: 1;
  modelAssessment?: ModelAssessment;
}

export interface PullRequestFacts extends FactsBase {
  event: "pull_request";
  pullRequest: PullRequestEvidence;
}

export interface MergeGroupFacts extends FactsBase {
  event: "merge_group";
  candidate: {
    subject: MergeGroupSubject;
    provenance: Provenance;
    checks: CheckEvidence[];
  };
  /** Authoritative current membership, independently bound from saved admissions. */
  members: PullRequestSubject[];
  admissions: PullRequestEvidence[];
}

export type EvidenceFacts = PullRequestFacts | MergeGroupFacts;
export interface EvidenceInput {
  facts: EvidenceFacts;
  policy: EvidencePolicy;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; input: EvidenceInput }
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

export type EvaluationResult =
  | {
      status: "invalid";
      eligible: false;
      issues: ValidationIssue[];
    }
  | {
      schemaVersion: 1;
      status: "evaluated";
      eligible: boolean;
      gates: GateDecision[];
      /** Detached snapshot of the exact normalized evidence and policy evaluated. */
      input: EvidenceInput;
      modelAssessment: {
        authority: "advisory";
        assessment: ModelAssessment | null;
      };
    };
