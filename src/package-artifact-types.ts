/** An explicit, finite exports tree. Patterns and fallback arrays are unsupported in this slice. */
export type PackageExport =
  | string
  | null
  | { [condition: string]: PackageExport };

export interface PackageArtifactContract {
  name: string;
  version: string;
  allowedFiles: string[];
  requiredFiles: string[];
  entrypoints: {
    exports: PackageExport;
    main?: string;
    module?: string;
    types?: string;
    typings?: string;
  };
  runtime: string;
  checks: { id: string; kind: "install" | "runtime" | "types" }[];
}

/** Supplied by trusted collection from the packed artifact, never the source workspace. */
export interface PackedPackageEvidence {
  integrity: string;
  files: string[];
  manifest: unknown;
}

export interface PackageArtifactSubject {
  repository: string;
  sourceRevision: string;
  validatorRevision: string;
  artifactIntegrity: string;
}

/** Shape and matching cannot authenticate this collector's isolation or process claims. */
export interface PackageConsumerEvidence extends PackageArtifactSubject {
  contractDigest: string;
  runtime: string;
  isolation: "disposable-artifact-only";
  cleanup: "complete" | "failed";
  checks: {
    id: string;
    status: "passed" | "failed" | "canceled" | "incomplete" | "unsupported";
  }[];
}

export interface PackageArtifactDecision {
  state: "complete" | "blocked" | "invalid" | "unsupported";
  reasons: string[];
  binding:
    | (PackageArtifactSubject & { contractDigest: string; runtime: string })
    | null;
}
