import { semver } from "bun";

import type {
  ReleaseVersionChange,
  ReleaseVersionDecision,
  ReleaseVersionInput,
  ReleaseVersionPolicy,
} from "./release-version-types.ts";
import {
  parseReleaseVersion,
  releaseVersionPolicyDigest,
  validVersionInput,
} from "./release-version-validation.ts";

/** Pure literal version/channel assessment, adapted from release-action's tag and first-core-delta helpers. */
export const evaluateReleaseVersion = (
  input: ReleaseVersionInput,
  policy: ReleaseVersionPolicy
): ReleaseVersionDecision => {
  const policyDigest = releaseVersionPolicyDigest(policy);
  if (policyDigest === null || !validVersionInput(input)) {
    return {
      binding: null,
      change: null,
      decision: "block",
      diagnostics: ["invalid-input"],
    };
  }
  const binding = { ...input, policyDigest };
  const block = (reason: string): ReleaseVersionDecision => ({
    binding,
    change: null,
    decision: "block",
    diagnostics: [reason],
  });
  const previous = parseReleaseVersion(input.previousVersion);
  const next = parseReleaseVersion(input.version);
  if (!previous || !next) {
    return block("invalid-version");
  }
  const identifier = next.prerelease?.split(".")[0];
  const expectedTag =
    next.prerelease === null
      ? policy.stableTag
      : policy.prereleaseTags.find((entry) => entry.identifier === identifier)
          ?.tag;
  if (expectedTag === undefined) {
    return block("unsupported-prerelease-channel");
  }
  if (input.tag !== expectedTag) {
    return block("channel-tag-mismatch");
  }
  // A comparator error cannot establish progression, even after syntax qualification.
  try {
    if (semver.order(input.version, input.previousVersion) !== 1) {
      return block("version-not-newer");
    }
  } catch {
    return block("unsupported-version-comparison");
  }
  let change: ReleaseVersionChange = "prerelease";
  if (next.major !== previous.major) {
    change = "major";
  } else if (next.minor !== previous.minor) {
    change = "minor";
  } else if (next.patch !== previous.patch) {
    change = "patch";
  } else if (next.prerelease === null) {
    change = "finalization";
  }
  return { binding, change, decision: "pass", diagnostics: [] };
};
