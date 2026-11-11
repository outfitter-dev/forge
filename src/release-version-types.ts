/** Literal facts to assess; collection and revision/producer authentication remain external. */
export interface ReleaseVersionInput {
  previousVersion: string;
  version: string;
  tag: string;
}

/** Product-owned destinations, with no default stable tag or inferred channel. */
export interface ReleaseVersionPolicy {
  stableTag: string;
  prereleaseTags: { identifier: string; tag: string }[];
}

/** Describes the actual delta; products map prerelease/finalization to their release intent. */
export type ReleaseVersionChange =
  | "major"
  | "minor"
  | "patch"
  | "prerelease"
  | "finalization";

export interface ReleaseVersionDecision {
  decision: "pass" | "block";
  binding: (ReleaseVersionInput & { policyDigest: string }) | null;
  change: ReleaseVersionChange | null;
  diagnostics: string[];
}
