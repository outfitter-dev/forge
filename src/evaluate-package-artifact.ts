import {
  boundedText,
  exportTargets,
  jsonRecord,
  packageArtifactContractDigest,
  packageFile,
  sha512Integrity,
  uniqueStrings,
} from "./package-artifact-contract.ts";
import type {
  PackageArtifactContract,
  PackageArtifactDecision,
  PackageArtifactSubject,
  PackageConsumerEvidence,
  PackedPackageEvidence,
} from "./package-artifact-types.ts";

const subjectKeys = [
  "repository",
  "sourceRevision",
  "validatorRevision",
  "artifactIntegrity",
] as const;
const validSubject = (subject: PackageArtifactSubject) =>
  jsonRecord(subject) &&
  subjectKeys.every((key) => boundedText(subject[key])) &&
  /^[^/\s]+\/[^/\s]+$/u.test(subject.repository) &&
  /^[a-f0-9]{40}$/u.test(subject.sourceRevision) &&
  /^[a-f0-9]{40}$/u.test(subject.validatorRevision) &&
  sha512Integrity(subject.artifactIntegrity);

interface Failure {
  state: "blocked" | "invalid" | "unsupported";
  reasons: string[];
}

const validPack = (pack: PackedPackageEvidence) =>
  jsonRecord(pack) &&
  sha512Integrity(pack.integrity) &&
  uniqueStrings(pack.files) &&
  pack.files.every(packageFile) &&
  jsonRecord(pack.manifest);

const unsupportedManifest = (manifest: Record<string, unknown>) =>
  ["dependencies", "optionalDependencies", "peerDependencies"].some(
    (key) =>
      manifest[key] !== undefined &&
      (!jsonRecord(manifest[key]) || Object.keys(manifest[key]).length > 0)
  ) ||
  manifest.bin !== undefined ||
  manifest.imports !== undefined;

const entrypointReasons = (
  contract: PackageArtifactContract,
  manifest: Record<string, unknown>,
  files: string[]
): Failure | null => {
  if (exportTargets(manifest.exports) === null) {
    return {
      reasons: ["unsupported-or-escaping-exports"],
      state: "unsupported",
    };
  }
  const reasons: string[] = [];
  for (const key of [
    "exports",
    "main",
    "module",
    "types",
    "typings",
  ] as const) {
    const expected = contract.entrypoints[key];
    const actual = manifest[key];
    if (
      key !== "exports" &&
      actual !== undefined &&
      typeof actual !== "string"
    ) {
      return { reasons: ["malformed-entrypoint"], state: "invalid" };
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      reasons.push(`entrypoint-mismatch:${key}`);
    }
    let targets: string[] | null = [];
    if (key === "exports") {
      targets = exportTargets(actual);
    } else if (typeof actual === "string") {
      targets = [actual.startsWith("./") ? actual.slice(2) : actual];
    }
    if (targets === null || targets.some((target) => !packageFile(target))) {
      return { reasons: ["escaping-entrypoint"], state: "invalid" };
    }
    for (const target of targets) {
      if (!files.includes(target)) {
        reasons.push(`missing-entrypoint:${target}`);
      }
    }
  }
  return reasons.length ? { reasons, state: "blocked" } : null;
};

const packReasons = (
  contract: PackageArtifactContract,
  pack: PackedPackageEvidence
): Failure | null => {
  if (!validPack(pack) || !jsonRecord(pack.manifest)) {
    return { reasons: ["invalid-pack-evidence"], state: "invalid" };
  }
  const { manifest } = pack;
  if (
    manifest.name !== contract.name ||
    manifest.version !== contract.version
  ) {
    return { reasons: ["package-identity-mismatch"], state: "blocked" };
  }
  // Dependencies need a complete collected artifact set; never fall back to a workspace/registry.
  if (unsupportedManifest(manifest)) {
    return { reasons: ["unsupported-package-shape"], state: "unsupported" };
  }
  const reasons: string[] = [];
  for (const file of contract.requiredFiles) {
    if (!pack.files.includes(file)) {
      reasons.push(`missing-file:${file}`);
    }
  }
  for (const file of pack.files) {
    if (!contract.allowedFiles.includes(file)) {
      reasons.push(`forbidden-file:${file}`);
    }
  }
  const entrypoints = entrypointReasons(contract, manifest, pack.files);
  if (
    entrypoints?.state === "invalid" ||
    entrypoints?.state === "unsupported"
  ) {
    return entrypoints;
  }
  reasons.push(...(entrypoints?.reasons ?? []));
  return reasons.length ? { reasons, state: "blocked" } : null;
};

const validConsumer = (consumer: PackageConsumerEvidence) =>
  jsonRecord(consumer) &&
  validSubject(consumer) &&
  boundedText(consumer.contractDigest) &&
  boundedText(consumer.runtime) &&
  Array.isArray(consumer.checks) &&
  consumer.checks.length <= 100 &&
  [...consumer.checks].every(
    (check) =>
      jsonRecord(check) &&
      boundedText(check.id) &&
      ["passed", "failed", "canceled", "incomplete", "unsupported"].includes(
        check.status
      )
  );

const consumerReasons = (
  contract: PackageArtifactContract,
  binding: NonNullable<PackageArtifactDecision["binding"]>,
  consumer: PackageConsumerEvidence | null
): Failure | null => {
  if (consumer === null) {
    return { reasons: ["missing-consumer-evidence"], state: "blocked" };
  }
  if (!validConsumer(consumer)) {
    return { reasons: ["invalid-consumer-evidence"], state: "invalid" };
  }
  if (
    subjectKeys.some((key) => consumer[key] !== binding[key]) ||
    consumer.contractDigest !== binding.contractDigest ||
    consumer.runtime !== binding.runtime
  ) {
    return { reasons: ["stale-consumer-evidence"], state: "blocked" };
  }
  if (consumer.isolation !== "disposable-artifact-only") {
    return { reasons: ["unclean-consumer"], state: "blocked" };
  }
  if (consumer.cleanup !== "complete") {
    return { reasons: ["consumer-cleanup-incomplete"], state: "blocked" };
  }
  if (
    new Set(consumer.checks.map((check) => check.id)).size !==
    consumer.checks.length
  ) {
    return { reasons: ["duplicate-consumer-check"], state: "invalid" };
  }
  if (
    consumer.checks.length !== contract.checks.length ||
    consumer.checks.some(
      (check) => !contract.checks.some((expected) => expected.id === check.id)
    )
  ) {
    return { reasons: ["consumer-check-set-mismatch"], state: "blocked" };
  }
  const reasons = consumer.checks
    .filter((check) => check.status !== "passed")
    .map((check) => `consumer-${check.status}:${check.id}`);
  return reasons.length ? { reasons, state: "blocked" } : null;
};

/** Evaluate trusted normalized pack/consumer evidence. This function executes no product code or IO. */
export const evaluatePackageArtifact = (
  contract: PackageArtifactContract,
  subject: PackageArtifactSubject,
  pack: PackedPackageEvidence,
  consumer: PackageConsumerEvidence | null
): PackageArtifactDecision => {
  const digest = packageArtifactContractDigest(contract);
  if (digest === null || !validSubject(subject)) {
    return { binding: null, reasons: ["invalid-input"], state: "invalid" };
  }
  const binding = {
    artifactIntegrity: subject.artifactIntegrity,
    contractDigest: digest,
    repository: subject.repository,
    runtime: contract.runtime,
    sourceRevision: subject.sourceRevision,
    validatorRevision: subject.validatorRevision,
  };
  const packed = packReasons(contract, pack);
  if (packed) {
    return { binding, ...packed };
  }
  if (pack.integrity !== subject.artifactIntegrity) {
    return {
      binding,
      reasons: ["artifact-integrity-mismatch"],
      state: "blocked",
    };
  }
  const unmet = consumerReasons(contract, binding, consumer);
  return unmet
    ? { binding, ...unmet }
    : { binding, reasons: [], state: "complete" };
};
