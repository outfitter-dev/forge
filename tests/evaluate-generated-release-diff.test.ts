import { describe, expect, test } from "bun:test";

import {
  evaluateGeneratedReleaseDiff,
  generatedReleaseDiffPolicyDigest,
} from "../src/index.ts";
import type {
  GeneratedReleaseDiffPolicy,
  GeneratedReleaseDiffSubject,
} from "../src/index.ts";
import {
  diffEvidence,
  diffPolicy,
  diffSubject,
} from "./generated-release-diff-fixtures.ts";

const evaluate = (files = diffEvidence().files) =>
  evaluateGeneratedReleaseDiff(diffSubject, diffPolicy, {
    ...diffEvidence(),
    files,
  });

describe("generated release diff assessment", () => {
  test("allows a paired partial package change and one declared deletion", () => {
    expect(evaluate()).toEqual({
      binding: {
        ...diffSubject,
        policyDigest: generatedReleaseDiffPolicyDigest(diffPolicy) ?? "invalid",
      },
      decision: "pass",
      diagnostics: [],
    });
  });
  test("allows all paired packages and multiple changeset deletions", () => {
    expect(
      evaluate([
        ...diffEvidence().files,
        { path: "packages/tokens/package.json", status: "M" },
        { path: "packages/tokens/CHANGELOG.md", status: "M" },
        { path: ".changeset/other.md", status: "D" },
      ]).decision
    ).toBe("pass");
  });
  test("supports explicit root and custom paths without inferring package directories", () => {
    const policy: GeneratedReleaseDiffPolicy = {
      changesetPaths: ["release/consumed-change.md"],
      packages: [
        {
          changelogPath: "release/HISTORY.md",
          manifestPath: "package.json",
          name: "root",
        },
      ],
      repository: diffSubject.repository,
    };
    expect(
      evaluateGeneratedReleaseDiff(diffSubject, policy, {
        ...diffEvidence(),
        files: [
          { path: "package.json", status: "M" },
          { path: "release/HISTORY.md", status: "M" },
          { path: "release/consumed-change.md", status: "D" },
        ],
        policyDigest: generatedReleaseDiffPolicyDigest(policy) ?? "invalid",
      }).decision
    ).toBe("pass");
  });
  test.each([
    [
      "manifest without changelog",
      [
        { path: "packages/ui/package.json", status: "M" },
        { path: ".changeset/brave-cats.md", status: "D" },
      ],
    ],
    [
      "changelog without manifest",
      [
        { path: "packages/ui/CHANGELOG.md", status: "M" },
        { path: ".changeset/brave-cats.md", status: "D" },
      ],
    ],
    ["missing changeset deletion", diffEvidence().files.slice(0, 2)],
    ["only changeset deletion", diffEvidence().files.slice(2)],
    ["empty diff", []],
    [
      "cross-package mismatched pair",
      [
        { path: "packages/ui/package.json", status: "M" },
        { path: "packages/tokens/CHANGELOG.md", status: "M" },
        { path: ".changeset/brave-cats.md", status: "D" },
      ],
    ],
  ])("blocks %s", (_name, files) => {
    expect(evaluate(files).decision).toBe("block");
    expect(evaluate(files).diagnostics.length).toBeGreaterThan(0);
  });
  test.each([
    ["M", "src/sneaky.ts"],
    ["M", "bun.lock"],
    ["D", ".changeset/README.md"],
    ["D", ".changeset/undeclared.md"],
    ["D", ".changeset/nested/change.md"],
    ["A", "packages/ui/package.json"],
    ["D", "packages/ui/CHANGELOG.md"],
    ["M", ".changeset/brave-cats.md"],
    ["A", ".changeset/brave-cats.md"],
    ["R100", "packages/ui/package.json"],
    ["C", "packages/ui/CHANGELOG.md"],
    ["T", "packages/ui/package.json"],
    ["U", "packages/ui/package.json"],
    ["unknown", "packages/ui/package.json"],
  ])("blocks unexpected status/path %s %s", (status, path) => {
    const files = diffEvidence().files.filter((file) => file.path !== path);
    const result = evaluate([...files, { path, status }]);
    expect(result.decision).toBe("block");
    expect(result.diagnostics).toContain(
      `Unexpected release diff entry: ${status} ${path}`
    );
  });
  test.each(["incomplete", "failed", "canceled", "unavailable"] as const)(
    "blocks %s collection even with passing paths",
    (state) => {
      expect(
        evaluateGeneratedReleaseDiff(diffSubject, diffPolicy, {
          ...diffEvidence(),
          state,
        }).diagnostics
      ).toEqual([`diff-${state}`]);
    }
  );
  test.each(Object.keys(diffSubject) as (keyof GeneratedReleaseDiffSubject)[])(
    "blocks stale %s",
    (key) => {
      const evidence = diffEvidence();
      evidence.subject[key] = key.endsWith("Sha")
        ? "f".repeat(40)
        : "other/value";
      expect(
        evaluateGeneratedReleaseDiff(diffSubject, diffPolicy, evidence)
          .diagnostics
      ).toEqual(["stale-evidence"]);
    }
  );
  test("blocks a policy from another repository", () => {
    const policy = { ...diffPolicy, repository: "other/repo" };
    expect(
      evaluateGeneratedReleaseDiff(diffSubject, policy, {
        ...diffEvidence(),
        policyDigest: generatedReleaseDiffPolicyDigest(policy) ?? "invalid",
      }).diagnostics
    ).toEqual(["repository-policy-mismatch"]);
  });
  test("policy changes invalidate evidence", () => {
    const policy = {
      ...diffPolicy,
      changesetPaths: [...diffPolicy.changesetPaths, ".changeset/new.md"],
    };
    expect(
      evaluateGeneratedReleaseDiff(diffSubject, policy, diffEvidence())
        .diagnostics
    ).toEqual(["stale-evidence"]);
  });
  test("canonicalizes object keys while retaining array order", () => {
    const policy = Object.fromEntries(
      Object.entries(diffPolicy)
        .toReversed()
        .map(([key, value]) => [
          key,
          key === "packages"
            ? diffPolicy.packages.map((pkg) =>
                Object.fromEntries(Object.entries(pkg).toReversed())
              )
            : value,
        ])
    ) as unknown as GeneratedReleaseDiffPolicy;
    expect(generatedReleaseDiffPolicyDigest(policy)).toBe(
      generatedReleaseDiffPolicyDigest(diffPolicy)
    );
    expect(
      evaluateGeneratedReleaseDiff(diffSubject, policy, diffEvidence()).decision
    ).toBe("pass");
    expect(
      generatedReleaseDiffPolicyDigest({
        ...policy,
        packages: policy.packages.toReversed(),
      })
    ).not.toBe(generatedReleaseDiffPolicyDigest(diffPolicy));
  });
  test("does not mutate inputs or depend on file order", () => {
    const evidence = diffEvidence();
    const before = structuredClone(evidence);
    evaluateGeneratedReleaseDiff(diffSubject, diffPolicy, evidence);
    expect(evidence).toEqual(before);
    expect(evaluate(evidence.files.toReversed())).toEqual(
      evaluate(evidence.files)
    );
  });
});
