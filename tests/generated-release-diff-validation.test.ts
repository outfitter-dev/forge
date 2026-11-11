import { expect, test } from "bun:test";

import {
  evaluateGeneratedReleaseDiff,
  generatedReleaseDiffPolicyDigest,
} from "../src/index.ts";
import type {
  GeneratedReleaseDiffEvidence,
  GeneratedReleaseDiffPolicy,
  GeneratedReleaseDiffSubject,
} from "../src/index.ts";
import {
  diffEvidence,
  diffPolicy,
  diffSubject,
} from "./generated-release-diff-fixtures.ts";

const unsafePolicy = (value: unknown) => value as GeneratedReleaseDiffPolicy;
const unsafeEvidence = (value: unknown) =>
  value as GeneratedReleaseDiffEvidence;

const sparseList = () => {
  const values = Array.from({ length: 1 });
  delete values[0];
  return values;
};

test.each([
  null,
  {},
  { ...diffPolicy, unknown: true },
  { ...diffPolicy, packages: [] },
  { ...diffPolicy, packages: sparseList() },
  { ...diffPolicy, changesetPaths: [] },
  { ...diffPolicy, changesetPaths: sparseList() },
  { ...diffPolicy, packages: [...diffPolicy.packages, diffPolicy.packages[0]] },
  { ...diffPolicy, changesetPaths: ["packages/ui/package.json"] },
  { ...diffPolicy, changesetPaths: ["same.md", "same.md"] },
  {
    ...diffPolicy,
    packages: [
      {
        ...diffPolicy.packages[0],
        changelogPath: "packages/ui/package.json",
      },
    ],
  },
  { ...diffPolicy, packages: [{ ...diffPolicy.packages[0], unknown: true }] },
  { ...diffPolicy, packages: [{ ...diffPolicy.packages[0], name: "" }] },
  { ...diffPolicy, repository: "repository-without-owner" },
])("rejects malformed or ambiguous policy %#", (value) => {
  expect(generatedReleaseDiffPolicyDigest(unsafePolicy(value))).toBeNull();
  expect(
    evaluateGeneratedReleaseDiff(
      diffSubject,
      unsafePolicy(value),
      diffEvidence()
    )
  ).toMatchObject({
    binding: null,
    decision: "block",
    diagnostics: ["invalid-input"],
  });
});

test.each([
  "../x",
  "/absolute",
  "a//b",
  "a/./b",
  "a/../b",
  "a\\b",
  "C:/x",
  "a\nb",
  "a\u0000b",
  "a\u0080b",
  "a\u009Fb",
  "a b",
  "",
  "a/",
  "x".repeat(513),
])("rejects noncanonical policy and evidence path %j", (path) => {
  expect(
    generatedReleaseDiffPolicyDigest({ ...diffPolicy, changesetPaths: [path] })
  ).toBeNull();
  expect(
    evaluateGeneratedReleaseDiff(diffSubject, diffPolicy, {
      ...diffEvidence(),
      files: [...diffEvidence().files, { path, status: "D" }],
    }).diagnostics
  ).toEqual(["invalid-evidence"]);
});

test.each([
  null,
  {},
  { ...diffEvidence(), unknown: true },
  { ...diffEvidence(), state: "success" },
  { ...diffEvidence(), policyDigest: "sha256-wrong" },
  { ...diffEvidence(), files: sparseList() },
  {
    ...diffEvidence(),
    files: [{ oldPath: "old.json", path: "package.json", status: "M" }],
  },
  { ...diffEvidence(), files: [{ path: "package.json", status: "" }] },
  {
    ...diffEvidence(),
    files: [...diffEvidence().files, diffEvidence().files[0]],
  },
  {
    ...diffEvidence(),
    files: Array.from({ length: 10_001 }, (_, i) => ({
      path: `file${i}`,
      status: "M",
    })),
  },
])("rejects malformed, duplicate or unbounded evidence %#", (value) => {
  expect(
    evaluateGeneratedReleaseDiff(diffSubject, diffPolicy, unsafeEvidence(value))
  ).toMatchObject({ decision: "block", diagnostics: ["invalid-evidence"] });
});

test.each([
  null,
  {},
  { ...diffSubject, headSha: "not-a-sha" },
  { ...diffSubject, runtime: "" },
  { ...diffSubject, unknown: true },
])("rejects invalid subject %#", (value) => {
  expect(
    evaluateGeneratedReleaseDiff(
      value as GeneratedReleaseDiffSubject,
      diffPolicy,
      diffEvidence()
    )
  ).toMatchObject({
    binding: null,
    decision: "block",
    diagnostics: ["invalid-input"],
  });
});
