import { createHash } from "node:crypto";

import type {
  ReleaseVersionInput,
  ReleaseVersionPolicy,
} from "./release-version-types.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
// Deliberately finite channel vocabulary: lowercase words/hyphens, never a numeric/range-like npm tag.
const tag = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 64 &&
  !/\s/u.test(value) &&
  /^[a-z]+(?:-[a-z]+)*$/u.test(value);
const validPolicy = (value: ReleaseVersionPolicy): boolean =>
  record(value) &&
  only(value, ["stableTag", "prereleaseTags"]) &&
  tag(value.stableTag) &&
  Array.isArray(value.prereleaseTags) &&
  value.prereleaseTags.length <= 100 &&
  [...value.prereleaseTags].every(
    (entry) =>
      record(entry) &&
      only(entry, ["identifier", "tag"]) &&
      tag(entry.identifier) &&
      tag(entry.tag) &&
      entry.tag !== value.stableTag
  ) &&
  new Set(value.prereleaseTags.map((entry) => entry.identifier)).size ===
    value.prereleaseTags.length;

export const releaseVersionPolicyDigest = (
  policy: ReleaseVersionPolicy
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

const boundedVersion = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
export const validVersionInput = (value: ReleaseVersionInput): boolean =>
  record(value) &&
  only(value, ["previousVersion", "version", "tag"]) &&
  boundedVersion(value.previousVersion) &&
  boundedVersion(value.version) &&
  tag(value.tag);

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

/** Strict syntax before Bun comparison: its parser intentionally accepts some noncanonical forms. */
export const parseReleaseVersion = (version: string): ParsedVersion | null => {
  if (/\s/u.test(version)) {
    return null;
  }
  const match =
    /^(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
      version
    )?.groups;
  if (!match) {
    return null;
  }
  const major = Number(match.major);
  const minor = Number(match.minor);
  const patch = Number(match.patch);
  const prerelease = match.pre ?? null;
  if (
    ![major, minor, patch].every(Number.isSafeInteger) ||
    prerelease
      ?.split(".")
      .some(
        (part) =>
          /^[0-9]+$/u.test(part) &&
          ((part.length > 1 && part.startsWith("0")) ||
            !Number.isSafeInteger(Number(part)))
      )
  ) {
    return null;
  }
  return { major, minor, patch, prerelease };
};
