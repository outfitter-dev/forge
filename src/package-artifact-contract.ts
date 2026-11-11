import { createHash } from "node:crypto";

import type { PackageArtifactContract } from "./package-artifact-types.ts";

export const jsonRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

export const boundedText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/\s/u.test(value) &&
  !value.includes(String.fromCodePoint(0));

export const packageFile = (value: unknown): value is string =>
  boundedText(value) &&
  !value.includes("\\") &&
  !value.includes(":") &&
  !value.includes("%") &&
  !value.includes("#") &&
  !value.includes("?") &&
  !value.includes("*") &&
  value
    .split("/")
    .every(
      (part) =>
        part !== "" && part !== "." && part !== ".." && part !== "node_modules"
    );

export const uniqueStrings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 1000 &&
  [...value].every(boundedText) &&
  new Set(value).size === value.length;

export const sha512Integrity = (value: unknown): value is string =>
  typeof value === "string" &&
  /^sha512-[A-Za-z0-9+/]{86}==$/u.test(value) &&
  Buffer.from(value.slice(7), "base64").toString("base64") === value.slice(7);

const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const validExportKeys = (keys: string[], depth: number): boolean => {
  if (keys.some((key) => key.startsWith("."))) {
    return (
      depth === 0 &&
      keys.every(
        (key) =>
          key === "." || (key.startsWith("./") && packageFile(key.slice(2)))
      )
    );
  }
  return keys.every((key) => /^[A-Za-z][A-Za-z0-9_-]*$/u.test(key));
};

/** Limit recursion and reject unsupported export syntax rather than guess resolution semantics. */
const collectExportTargets = (
  value: unknown,
  depth: number,
  budget: { remaining: number }
): string[] | null => {
  budget.remaining -= 1;
  if (depth > 10 || budget.remaining < 0) {
    return null;
  }
  if (value === null) {
    return [];
  }
  if (typeof value === "string") {
    return value.startsWith("./") && packageFile(value.slice(2))
      ? [value.slice(2)]
      : null;
  }
  if (
    !jsonRecord(value) ||
    Object.keys(value).length === 0 ||
    Object.keys(value).length > 100
  ) {
    return null;
  }
  if (!validExportKeys(Object.keys(value), depth)) {
    return null;
  }
  const targets: string[] = [];
  for (const target of Object.values(value)) {
    const nested = collectExportTargets(target, depth + 1, budget);
    if (nested === null) {
      return null;
    }
    targets.push(...nested);
  }
  return targets;
};

export const exportTargets = (value: unknown): string[] | null =>
  collectExportTargets(value, 0, { remaining: 1000 });

const validFilesContract = (value: PackageArtifactContract) =>
  uniqueStrings(value.allowedFiles) &&
  uniqueStrings(value.requiredFiles) &&
  value.allowedFiles.every(packageFile) &&
  value.requiredFiles.every(packageFile) &&
  value.requiredFiles.includes("package.json") &&
  value.requiredFiles.every((file) => value.allowedFiles.includes(file));

const validEntrypoints = (
  entrypoints: PackageArtifactContract["entrypoints"]
) => {
  if (
    !jsonRecord(entrypoints) ||
    !only(entrypoints, ["exports", "main", "module", "types", "typings"]) ||
    !Object.hasOwn(entrypoints, "exports") ||
    exportTargets(entrypoints.exports) === null
  ) {
    return false;
  }
  return Object.entries(entrypoints).every(
    ([key, target]) =>
      key === "exports" ||
      (boundedText(target) &&
        packageFile(target.startsWith("./") ? target.slice(2) : target))
  );
};

const validChecks = (checks: PackageArtifactContract["checks"]) => {
  if (!Array.isArray(checks) || checks.length > 100) {
    return false;
  }
  const items = [...checks];
  return (
    items.every(
      (check) =>
        jsonRecord(check) &&
        only(check, ["id", "kind"]) &&
        boundedText(check.id) &&
        ["install", "runtime", "types"].includes(check.kind)
    ) &&
    new Set(items.map((check) => check.id)).size === items.length &&
    ["install", "runtime", "types"].every((kind) =>
      items.some((check) => check.kind === kind)
    )
  );
};

export const validPackageContract = (value: PackageArtifactContract): boolean =>
  jsonRecord(value) &&
  only(value, [
    "name",
    "version",
    "allowedFiles",
    "requiredFiles",
    "entrypoints",
    "runtime",
    "checks",
  ]) &&
  boundedText(value.name) &&
  boundedText(value.version) &&
  boundedText(value.runtime) &&
  validFilesContract(value) &&
  validEntrypoints(value.entrypoints) &&
  validChecks(value.checks);

/** Exact serialized contract identity includes exports key order, which affects condition priority. */
export const packageArtifactContractDigest = (
  contract: PackageArtifactContract
): string | null =>
  validPackageContract(contract)
    ? `sha256-${createHash("sha256").update(JSON.stringify(contract)).digest("hex")}`
    : null;
