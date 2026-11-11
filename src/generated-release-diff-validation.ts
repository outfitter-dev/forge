import { createHash } from "node:crypto";

import type {
  GeneratedReleaseDiffEvidence,
  GeneratedReleaseDiffPolicy,
  GeneratedReleaseDiffSubject,
} from "./generated-release-diff-types.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/\s/u.test(value) &&
  [...value].every(
    (char) => (char.codePointAt(0) ?? 0) > 31 && char.codePointAt(0) !== 127
  );
const path = (value: unknown): value is string =>
  text(value) &&
  !value.includes("\\") &&
  !value.includes(":") &&
  value
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
const list = <T>(value: unknown, valid: (item: T) => boolean): value is T[] =>
  Array.isArray(value) && value.length <= 10_000 && [...value].every(valid);
const unique = (values: string[]) => new Set(values).size === values.length;
const sha = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
const repository = (value: unknown) =>
  text(value) && /^[^/]+\/[^/]+$/u.test(value);

export const validDiffSubject = (value: GeneratedReleaseDiffSubject): boolean =>
  record(value) &&
  only(value, [
    "repository",
    "baseSha",
    "headSha",
    "workflowSha",
    "validatorSha",
    "runtime",
  ]) &&
  repository(value.repository) &&
  sha(value.baseSha) &&
  sha(value.headSha) &&
  sha(value.workflowSha) &&
  sha(value.validatorSha) &&
  text(value.runtime);

const validPackage = (value: GeneratedReleaseDiffPolicy["packages"][number]) =>
  record(value) &&
  only(value, ["name", "manifestPath", "changelogPath"]) &&
  text(value.name) &&
  path(value.manifestPath) &&
  path(value.changelogPath);

const validPolicy = (value: GeneratedReleaseDiffPolicy): boolean => {
  if (
    !(
      record(value) &&
      only(value, ["repository", "packages", "changesetPaths"]) &&
      repository(value.repository) &&
      list(value.packages, validPackage) &&
      value.packages.length > 0 &&
      value.packages.length <= 100 &&
      list(value.changesetPaths, path) &&
      value.changesetPaths.length > 0
    )
  ) {
    return false;
  }
  return (
    unique(value.packages.map((pkg) => pkg.name)) &&
    unique([
      ...value.packages.flatMap((pkg) => [pkg.manifestPath, pkg.changelogPath]),
      ...value.changesetPaths,
    ])
  );
};

/** Object key order is irrelevant; declared array order remains bound. */
export const generatedReleaseDiffPolicyDigest = (
  policy: GeneratedReleaseDiffPolicy
): string | null => {
  if (!validPolicy(policy)) {
    return null;
  }
  const serialized = JSON.stringify(policy, (_key, value: unknown) =>
    record(value)
      ? Object.fromEntries(
          Object.keys(value)
            .toSorted()
            .map((key) => [key, value[key]])
        )
      : value
  );
  return `sha256-${createHash("sha256").update(serialized).digest("hex")}`;
};

export const validDiffEvidence = (
  value: GeneratedReleaseDiffEvidence
): boolean =>
  record(value) &&
  only(value, ["subject", "policyDigest", "state", "files"]) &&
  validDiffSubject(value.subject) &&
  typeof value.policyDigest === "string" &&
  /^sha256-[a-f0-9]{64}$/u.test(value.policyDigest) &&
  ["complete", "incomplete", "failed", "canceled", "unavailable"].includes(
    value.state
  ) &&
  list(
    value.files,
    (file: GeneratedReleaseDiffEvidence["files"][number]) =>
      record(file) &&
      only(file, ["path", "status"]) &&
      path(file.path) &&
      text(file.status)
  ) &&
  unique(value.files.map((file) => file.path));
