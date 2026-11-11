export interface NpmPublication {
  name: string;
  version: string;
  tag: string;
  /** Exact canonical SHA-512 SRI of the staged tarball, supplied by its owner. */
  integrity: string;
}

export interface NpmEvidencePolicy {
  provenancePredicateType: string;
}

export type NpmEvidenceState =
  | "complete"
  | "incomplete"
  | "conflict"
  | "invalid"
  | "unavailable";

export type NpmEvidenceReason =
  | "invalid-input"
  | "malformed-metadata"
  | "identity-mismatch"
  | "missing-version"
  | "missing-integrity"
  | "integrity-conflict"
  | "missing-provenance-reference"
  | "provenance-predicate-mismatch"
  | "dist-tag-mismatch"
  | "authentication"
  | "rate-limit"
  | "network"
  | "registry-error";

/** No response text, process stderr, tokens or arbitrary error messages are retained. */
export interface NpmEvidenceDecision {
  state: NpmEvidenceState;
  reasons: NpmEvidenceReason[];
}

export type NpmRegistryRead =
  | { status: "found"; document: unknown }
  | { status: "not-found" }
  | {
      status: "unavailable";
      reason: "authentication" | "rate-limit" | "network" | "registry-error";
    };

export interface NpmObservationPolicy extends NpmEvidencePolicy {
  maxAttempts: number;
  timeoutMs: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

/** The trusted adapter owns HTTPS origin/authentication; this interface cannot publish. */
export interface NpmEvidenceIO {
  read: (name: string, signal: AbortSignal) => Promise<NpmRegistryRead>;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<unknown>;
  now: () => number;
}

export interface NpmObservationResult {
  schemaVersion: 1;
  complete: boolean;
  stopped:
    | "complete"
    | "blocked"
    | "attempt-limit"
    | "deadline"
    | "aborted"
    | "invalid-input";
  attempts: number;
  publications: NpmPublication[];
  policy: NpmObservationPolicy | null;
  packages: NpmEvidenceDecision[];
  /** Registry metadata/reference checks do not authenticate attestation producers. */
  provenanceVerification: "reference-only";
}
