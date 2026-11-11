export interface GeneratedReleaseDiffSubject {
  repository: string;
  baseSha: string;
  headSha: string;
  workflowSha: string;
  validatorSha: string;
  runtime: string;
}

/** Trusted product policy; no package discovery, inferred paths or organization defaults. */
export interface GeneratedReleaseDiffPolicy {
  repository: string;
  packages: { name: string; manifestPath: string; changelogPath: string }[];
  /** Exact deletable changeset paths, selected from the trusted base. At least one must be deleted. */
  changesetPaths: string[];
}

/** Complete name-status observations from a trusted collector. Shape is not authentication. */
export interface GeneratedReleaseDiffEvidence {
  subject: GeneratedReleaseDiffSubject;
  policyDigest: string;
  state: "complete" | "incomplete" | "failed" | "canceled" | "unavailable";
  files: { path: string; status: string }[];
}

export interface GeneratedReleaseDiffDecision {
  decision: "pass" | "block";
  binding: (GeneratedReleaseDiffSubject & { policyDigest: string }) | null;
  diagnostics: string[];
}
