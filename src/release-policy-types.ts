export type ReleaseCheckState =
  | "passed"
  | "failed"
  | "missing"
  | "incomplete"
  | "canceled"
  | "skipped"
  | "unsupported";

export interface ReleaseSubject {
  repository: string;
  ref: string;
  sourceSha: string;
  workflowSha: string;
  validatorSha: string;
  runtime: string;
  artifactIntegrity: string;
  version: string;
  tag: string;
}

/** Product-owned requirements, loaded from trusted policy outside the proposal. No defaults. */
export interface ReleasePolicy {
  repository: string;
  ref: string;
  channels: { label: string; tag: string; autoAllowed: boolean }[];
  releaseLabels: string[];
  requiredChecks: string[];
  autoChecks: string[];
  ciChecks: { name: string; producer: string }[];
}

/** Trusted normalized observations; matching and shape are not producer authentication. */
export interface ReleasePolicyEvidence {
  subject: ReleaseSubject;
  policyDigest: string;
  labels: string[];
  noPublishReason: string | null;
  publication:
    | "unpublished"
    | "complete"
    | "partial"
    | "conflict"
    | "unavailable";
  checks: { id: string; state: ReleaseCheckState }[];
  ci: {
    proof: "exact-sha" | "release-pr-head" | "assumed";
    testedSha: string;
    checks: {
      name: string;
      producer: string;
      runId: string;
      state: ReleaseCheckState;
    }[];
  } | null;
}

export interface ReleasePolicyDecision {
  decision: "auto" | "manual" | "none" | "block";
  blockers: string[];
  diagnostics: string[];
  reasons: string[];
  binding: (ReleaseSubject & { policyDigest: string }) | null;
}
