import type {
  NpmEvidenceDecision,
  NpmEvidencePolicy,
  NpmPublication,
  NpmRegistryRead,
} from "./npm-evidence-types.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const own = (value: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined;

const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/\s/u.test(value);

export const validNpmPublication = (value: NpmPublication): boolean =>
  record(value) &&
  Object.keys(value).every((key) =>
    ["name", "version", "tag", "integrity"].includes(key)
  ) &&
  text(value.name) &&
  text(value.version) &&
  text(value.tag) &&
  typeof value.integrity === "string" &&
  /^sha512-[A-Za-z0-9+/]{86}==$/u.test(value.integrity) &&
  Buffer.from(value.integrity.slice(7), "base64").toString("base64") ===
    value.integrity.slice(7);

export const validNpmEvidencePolicy = (policy: NpmEvidencePolicy): boolean =>
  record(policy) &&
  text(policy.provenancePredicateType) &&
  Object.keys(policy).every((key) =>
    [
      "provenancePredicateType",
      "maxAttempts",
      "timeoutMs",
      "initialDelayMs",
      "maxDelayMs",
    ].includes(key)
  );

const decision = (
  state: NpmEvidenceDecision["state"],
  ...reasons: NpmEvidenceDecision["reasons"]
): NpmEvidenceDecision => ({ reasons, state });

interface VersionMetadata {
  dist: Record<string, unknown>;
  tags: Record<string, unknown> | undefined;
}

type MetadataResult =
  | { metadata: VersionMetadata }
  | { decision: NpmEvidenceDecision };

const versionMetadata = (
  publication: NpmPublication,
  document: Record<string, unknown>
): MetadataResult => {
  if (own(document, "name") !== publication.name) {
    return { decision: decision("invalid", "identity-mismatch") };
  }
  const versions = own(document, "versions");
  const tags = own(document, "dist-tags");
  if (!record(versions) || (tags !== undefined && !record(tags))) {
    return { decision: decision("invalid", "malformed-metadata") };
  }
  const version = own(versions, publication.version);
  if (version === undefined) {
    return { decision: decision("incomplete", "missing-version") };
  }
  if (!record(version)) {
    return { decision: decision("invalid", "malformed-metadata") };
  }
  if (
    own(version, "name") !== publication.name ||
    own(version, "version") !== publication.version
  ) {
    return { decision: decision("invalid", "identity-mismatch") };
  }
  const dist = own(version, "dist");
  if (dist === undefined) {
    return { metadata: { dist: {}, tags } };
  }
  if (!record(dist)) {
    return { decision: decision("invalid", "malformed-metadata") };
  }
  return { metadata: { dist, tags } };
};

const provenanceEvidence = (
  dist: Record<string, unknown>,
  policy: NpmEvidencePolicy
): NpmEvidenceDecision => {
  const attestations = own(dist, "attestations");
  if (attestations !== undefined && !record(attestations)) {
    return decision("invalid", "malformed-metadata");
  }
  const provenance =
    attestations === undefined ? undefined : own(attestations, "provenance");
  if (provenance !== undefined && !record(provenance)) {
    return decision("invalid", "malformed-metadata");
  }
  const predicate =
    provenance === undefined ? undefined : own(provenance, "predicateType");
  if (predicate === undefined) {
    return decision("incomplete", "missing-provenance-reference");
  }
  if (typeof predicate !== "string") {
    return decision("invalid", "malformed-metadata");
  }
  return predicate === policy.provenancePredicateType
    ? decision("complete")
    : decision("incomplete", "provenance-predicate-mismatch");
};

const artifactEvidence = (
  publication: NpmPublication,
  metadata: VersionMetadata,
  policy: NpmEvidencePolicy
): NpmEvidenceDecision => {
  const { dist, tags } = metadata;
  const integrity = own(dist, "integrity");
  if (integrity !== undefined && typeof integrity !== "string") {
    return decision("invalid", "malformed-metadata");
  }
  if (integrity !== undefined && integrity !== publication.integrity) {
    return decision("conflict", "integrity-conflict");
  }
  const provenance = provenanceEvidence(dist, policy);
  if (provenance.state === "invalid") {
    return provenance;
  }
  const reasons: NpmEvidenceDecision["reasons"] = [];
  if (integrity === undefined) {
    reasons.push("missing-integrity");
  }
  reasons.push(...provenance.reasons);
  const taggedVersion =
    tags === undefined ? undefined : own(tags, publication.tag);
  if (taggedVersion !== undefined && typeof taggedVersion !== "string") {
    return decision("invalid", "malformed-metadata");
  }
  if (taggedVersion !== publication.version) {
    reasons.push("dist-tag-mismatch");
  }
  return decision(reasons.length === 0 ? "complete" : "incomplete", ...reasons);
};

/** Evaluate the relevant npm packument fields; unrelated registry fields remain opaque. */
export const evaluateNpmEvidence = (
  publication: NpmPublication,
  observation: NpmRegistryRead,
  policy: NpmEvidencePolicy
): NpmEvidenceDecision => {
  if (!validNpmPublication(publication) || !validNpmEvidencePolicy(policy)) {
    return decision("invalid", "invalid-input");
  }
  if (!record(observation)) {
    return decision("invalid", "malformed-metadata");
  }
  if (observation.status === "unavailable") {
    return [
      "authentication",
      "rate-limit",
      "network",
      "registry-error",
    ].includes(observation.reason)
      ? decision("unavailable", observation.reason)
      : decision("invalid", "malformed-metadata");
  }
  if (observation.status === "not-found") {
    return decision("incomplete", "missing-version");
  }
  if (observation.status !== "found" || !record(observation.document)) {
    return decision("invalid", "malformed-metadata");
  }
  const parsed = versionMetadata(publication, observation.document);
  return "decision" in parsed
    ? parsed.decision
    : artifactEvidence(publication, parsed.metadata, policy);
};

/** Adapted from Skillset SET-514: an exact occupied-version diagnostic only earns verification. */
export const classifyNpmPublishResult = (
  version: string,
  result: { exitCode: number; stderr: string }
): { outcome: "verify" | "failed"; publishSucceeded: boolean } => {
  if (
    !text(version) ||
    !record(result) ||
    !Number.isSafeInteger(result.exitCode) ||
    result.exitCode < 0 ||
    typeof result.stderr !== "string"
  ) {
    return { outcome: "failed", publishSucceeded: false };
  }
  if (result.exitCode === 0) {
    return { outcome: "verify", publishSucceeded: true };
  }
  const suffix = `You cannot publish over the previously published versions: ${version}`;
  const occupied = result.stderr
    .split(/\r?\n/u)
    .some(
      (line) =>
        line.trim().endsWith(suffix) || line.trim().endsWith(`${suffix}.`)
    );
  return { outcome: occupied ? "verify" : "failed", publishSucceeded: false };
};
