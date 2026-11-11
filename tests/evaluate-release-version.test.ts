import { describe, expect, test } from "bun:test";

import {
  evaluateReleaseVersion,
  releaseVersionPolicyDigest,
} from "../src/index.ts";
import type {
  ReleaseVersionInput,
  ReleaseVersionPolicy,
} from "../src/index.ts";

const policy: ReleaseVersionPolicy = {
  prereleaseTags: [
    { identifier: "beta", tag: "preview" },
    { identifier: "rc", tag: "preview" },
    { identifier: "edge", tag: "edge" },
  ],
  stableTag: "stable",
};
const input: ReleaseVersionInput = {
  previousVersion: "1.2.3",
  tag: "stable",
  version: "1.2.4",
};
const assess = (previousVersion: string, version: string, tag = "stable") =>
  evaluateReleaseVersion({ previousVersion, tag, version }, policy);

describe("strict release version/channel assessment", () => {
  test.each([
    ["1.2.3", "2.0.0", "major"],
    ["1.2.3", "1.3.0", "minor"],
    ["1.2.3", "1.2.4", "patch"],
    ["0.0.0", "0.0.1", "patch"],
    ["1.0.0-beta.1", "1.0.0", "finalization"],
    ["2.3.0-rc.0", "2.3.0", "finalization"],
    ["1.2.3+build.7", "1.2.4+build.8", "patch"],
    ["1.2.3", "1.2.4+0007.test-branch", "patch"],
    ["9007199254740990.0.0", "9007199254740991.0.0", "major"],
  ] as const)("assesses %s -> %s as %s", (previous, next, change) => {
    expect(assess(previous, next)).toMatchObject({
      change,
      decision: "pass",
      diagnostics: [],
    });
  });
  test.each([
    ["1.2.3", "2.0.0-rc.0", "major"],
    ["1.2.3", "1.3.0-beta.0", "minor"],
    ["1.2.3", "1.2.4-beta.0", "patch"],
    ["1.2.3-beta.1", "1.2.3-beta.2", "prerelease"],
    ["1.2.3-beta.2", "1.2.3-beta.10", "prerelease"],
    ["1.2.3-beta", "1.2.3-beta.1", "prerelease"],
    ["1.2.3-beta.1", "1.2.3-rc.0", "prerelease"],
    ["1.2.3-beta.1", "1.2.3-beta.a", "prerelease"],
    ["1.2.3-beta.1+build.1", "1.2.3-beta.2+build.2", "prerelease"],
    ["1.2.3-beta.1", "1.2.3-beta.2+001", "prerelease"],
    [
      "1.2.3-beta.9007199254740990",
      "1.2.3-beta.9007199254740991",
      "prerelease",
    ],
  ] as const)(
    "preserves prerelease channel %s -> %s",
    (previous, next, change) => {
      expect(assess(previous, next, "preview")).toMatchObject({
        change,
        decision: "pass",
        diagnostics: [],
      });
    }
  );
  test("returns literal inputs and canonical policy binding", () => {
    expect(evaluateReleaseVersion(input, policy)).toEqual({
      binding: {
        ...input,
        policyDigest: releaseVersionPolicyDigest(policy) ?? "invalid",
      },
      change: "patch",
      decision: "pass",
      diagnostics: [],
    });
  });
  test("permits explicit custom channel and stable-only policy", () => {
    expect(assess("1.0.0", "1.0.1-edge", "edge").decision).toBe("pass");
    expect(
      evaluateReleaseVersion(input, { prereleaseTags: [], stableTag: "stable" })
        .decision
    ).toBe("pass");
  });
  test.each([
    ["1.2.3", "1.2.3", "stable"],
    ["1.2.3", "1.2.2", "stable"],
    ["2.0.0", "1.99.99", "stable"],
    ["1.2.3", "1.2.3-beta.1", "preview"],
    ["1.2.3-beta.10", "1.2.3-beta.2", "preview"],
    ["1.2.3-rc.0", "1.2.3-beta.1", "preview"],
    ["1.2.3+one", "1.2.3+two", "stable"],
    ["1.2.3-beta.1+one", "1.2.3-beta.1+two", "preview"],
  ])("blocks equal or older %s -> %s", (previous, next, tag) => {
    expect(assess(previous, next, tag).diagnostics).toEqual([
      "version-not-newer",
    ]);
  });
  test.each([
    "",
    "latest",
    "1",
    "1.2",
    "v1.2.3",
    "=1.2.3",
    " 1.2.3",
    "1.2.3 ",
    "1.2.3\n",
    "1.2.3\r",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "-1.2.3",
    "1.2.3.4",
    "1.2.3-",
    "1.2.3-.next",
    "1.2.3-beta..1",
    "1.2.3-beta.01",
    "1.2.3-01",
    "1.2.3+",
    "1.2.3+build..7",
    "1.2.3+build/7",
    "1.2.3-beta.2+build..7",
    "1.2.3-β.1",
    "1.2.3+build\u0080",
    "9007199254740992.0.0",
    "1.9007199254740992.0",
    "1.0.9007199254740992",
    "1.2.3-beta.9007199254740992",
  ])(
    "malformed/unsupported version never falls back to stable: %j",
    (version) => {
      expect(assess("0.0.0", version).decision).toBe("block");
      expect(assess(version, "2.0.0").decision).toBe("block");
    }
  );
  test.each([
    "1.2.4-unknown.1",
    "1.2.4-BETA.1",
    "1.2.4-0",
    "1.2.4-beta-other.1",
  ])("blocks undeclared first identifier %s", (version) => {
    expect(assess("1.2.3", version, "preview").diagnostics).toEqual([
      "unsupported-prerelease-channel",
    ]);
  });
  test.each([
    ["1.2.4-beta.1", "stable"],
    ["1.2.4-beta.1+build.7", "stable"],
    ["1.2.4", "preview"],
    ["1.2.4+build.7", "preview"],
    ["1.2.4-beta.1", "latest"],
  ])("blocks wrong destination for %s", (version, tag) => {
    expect(assess("1.2.3", version, tag).diagnostics).toEqual([
      "channel-tag-mismatch",
    ]);
  });
  test("uses policy changes without inferring a previous channel from current policy", () => {
    expect(assess("1.2.3-old.1", "1.2.3").change).toBe("finalization");
    const changedPolicy = { ...policy, stableTag: "latest" };
    expect(releaseVersionPolicyDigest(changedPolicy)).not.toBe(
      releaseVersionPolicyDigest(policy)
    );
    expect(evaluateReleaseVersion(input, changedPolicy).diagnostics).toEqual([
      "channel-tag-mismatch",
    ]);
  });
  test("canonicalizes object keys, preserves list order and does not mutate inputs", () => {
    const reordered = Object.fromEntries(
      Object.entries(policy)
        .toReversed()
        .map(([key, value]) => [
          key,
          key === "prereleaseTags"
            ? policy.prereleaseTags.map((entry) =>
                Object.fromEntries(Object.entries(entry).toReversed())
              )
            : value,
        ])
    ) as unknown as ReleaseVersionPolicy;
    const before = structuredClone({ input, policy });
    expect(releaseVersionPolicyDigest(reordered)).toBe(
      releaseVersionPolicyDigest(policy)
    );
    expect(evaluateReleaseVersion(input, reordered)).toEqual(
      evaluateReleaseVersion(input, policy)
    );
    expect(
      releaseVersionPolicyDigest({
        ...policy,
        prereleaseTags: policy.prereleaseTags.toReversed(),
      })
    ).not.toBe(releaseVersionPolicyDigest(policy));
    expect({ input, policy }).toEqual(before);
  });
});

const sparse = Array.from({ length: 1 });
delete sparse[0];
test.each([
  null,
  {},
  { ...policy, unknown: true },
  { ...policy, stableTag: "" },
  { ...policy, prereleaseTags: sparse },
  {
    ...policy,
    prereleaseTags: [policy.prereleaseTags[0], policy.prereleaseTags[0]],
  },
  { ...policy, prereleaseTags: [{ identifier: "beta", tag: "stable" }] },
  {
    ...policy,
    prereleaseTags: [{ extra: true, identifier: "beta", tag: "preview" }],
  },
  {
    ...policy,
    prereleaseTags: Array.from({ length: 101 }, (_, i) => ({
      identifier: `channel-${i}`,
      tag: "preview",
    })),
  },
  ...[
    "latest\n",
    "beta\u0080",
    "next/other",
    "*",
    "v1",
    "beta.1",
    "Beta",
    "x".repeat(65),
  ].map((stableTag) => ({ ...policy, stableTag })),
])("rejects invalid/ambiguous policy %#", (value) => {
  const unsafe = value as ReleaseVersionPolicy;
  expect(releaseVersionPolicyDigest(unsafe)).toBeNull();
  expect(evaluateReleaseVersion(input, unsafe)).toEqual({
    binding: null,
    change: null,
    decision: "block",
    diagnostics: ["invalid-input"],
  });
});

test.each([
  null,
  {},
  { ...input, extra: true },
  { ...input, previousVersion: null },
  { ...input, tag: "stable\n" },
  { ...input, version: "x".repeat(257) },
])("rejects malformed input %#", (value) => {
  expect(
    evaluateReleaseVersion(value as ReleaseVersionInput, policy)
  ).toMatchObject({ binding: null, change: null, decision: "block" });
});
