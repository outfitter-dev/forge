import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { InvalidEvidenceError } from "../src/evidence-validation-primitives.ts";
import { parseFindingSourcesPolicy } from "../src/finding-source-policy.ts";
import { readGateInputs } from "../src/gate-inputs.ts";
import { parseGatePolicy } from "../src/gate-policy.ts";
import { at } from "./evidence-fixtures.ts";
import { gatePolicy } from "./gate-fixtures.ts";

const source = () => ({
  accountId: 123,
  actorType: "Bot",
  externalCoverage: "qualified",
  formats: ["github-thread-v1", "devin-review-v1"],
  qualificationRef: "qualification:example",
  reviewer: "example-bot",
  surfaces: ["review", "issue-comment", "thread-comment"],
});
const policy = () => ({
  policyRevision: "a".repeat(40),
  resolution: "github-native",
  sources: [source()],
  unqualifiedSources: [],
});
const scoped = () =>
  gatePolicy({
    findingSources: policy(),
    reviewAdapters: [],
    schemaVersion: 2,
  });

test("the Forge candidate names observed reporters while retaining its live coverage gaps", async () => {
  const candidate = parseGatePolicy(
    await Bun.file(
      new URL(
        "../examples/gate/configured-reporters.candidate.json",
        import.meta.url
      )
    ).json()
  );
  expect(candidate.findingSources?.unqualifiedSources).toEqual([
    "github-code-scanning",
  ]);
  expect(candidate.findingSources?.policyRevision).toBe(
    "76cb6e3a9ba9d29a8a90d9075a0db850c04dbcde"
  );
  expect(
    candidate.findingSources?.sources
      .map((entry) => entry.accountId)
      .toSorted((left, right) => left - right)
  ).toEqual([62_310_815, 158_243_242, 199_175_422, 206_951_365, 222_613_912]);
  expect(
    candidate.findingSources?.sources.find(
      (entry) => entry.accountId === 62_310_815
    )
  ).toMatchObject({
    actorType: "Bot",
    externalCoverage: "unknown",
    formats: ["github-thread-v1"],
    reviewer: "github-advanced-security",
  });
  expect(
    candidate.findingSources?.sources.every(
      (entry) =>
        entry.externalCoverage === "unknown" && entry.qualificationRef === null
    )
  ).toBe(true);
  const current = parseGatePolicy(
    await Bun.file(new URL("../forge-gate.json", import.meta.url)).json()
  );
  expect(current.findingSources).toBeUndefined();
});

test("source identity and declared scope determine a canonical immutable policy digest", () => {
  const config = policy();
  const parsed = parseFindingSourcesPolicy(config);
  expect(parsed.policyDigest).toMatch(/^[a-f\d]{64}$/u);
  expect(parseFindingSourcesPolicy(parsed)).toEqual(parsed);
  at(config.sources).formats.reverse();
  at(config.sources).surfaces.reverse();
  expect(parseFindingSourcesPolicy(config)).toEqual(parsed);
  at(config.sources).accountId += 1;
  expect(parseFindingSourcesPolicy(config).policyDigest).not.toBe(
    parsed.policyDigest
  );
  expect(at(parsed.sources).accountId).toBe(123);
});

test.each([
  { policyRevision: "branch-name" },
  { resolution: "arbitrary-approval" },
  { policyDigest: "0".repeat(64) },
  { sources: [] },
  { sources: [source(), source()] },
  { sources: [{ ...source(), formats: ["unknown-v2"] }] },
  { sources: [{ ...source(), formats: ["devin-review-v1"] }] },
  { sources: [{ ...source(), surfaces: ["review"] }] },
  { sources: [{ ...source(), actorType: "User" }] },
  { sources: [{ ...source(), accountId: 0 }] },
  { sources: [{ ...source(), qualificationRef: null }] },
  { sources: [{ ...source(), externalCoverage: "assumed" }] },
  { unqualifiedSources: ["code-scanning", "code-scanning"] },
])("invalid source scope is refused before collection (%p)", (override) => {
  expect(() => parseFindingSourcesPolicy({ ...policy(), ...override })).toThrow(
    InvalidEvidenceError
  );
});

test("scoped sources require modern policy and retain explicit unknown coverage", () => {
  expect(() => parseGatePolicy({ ...scoped(), schemaVersion: 1 })).toThrow(
    InvalidEvidenceError
  );
  const value = scoped();
  value.findingSources = {
    ...policy(),
    sources: [
      { ...source(), externalCoverage: "unknown", qualificationRef: null },
    ],
    unqualifiedSources: ["github-code-scanning"],
  };
  expect(parseGatePolicy(value).findingSources).toMatchObject({
    sources: [{ externalCoverage: "unknown" }],
    unqualifiedSources: ["github-code-scanning"],
  });
});

test("native resolution authority is derived only from the declared source policy", () => {
  const parsed = parseGatePolicy(scoped());
  const authority = {
    policyDigest: parsed.findingSources?.policyDigest,
    policyRevision: parsed.findingSources?.policyRevision,
    reviewers: ["example-bot"],
    sourceAccounts: [
      { accountId: 123, actorType: "Bot", reviewer: "example-bot" },
    ],
  };
  expect(
    (parsed.evidence.agentReview as Record<string, unknown>).findingSources
  ).toEqual(authority);
  const value = scoped();
  (value.evidence as Record<string, unknown>).agentReview = {
    ...((value.evidence as Record<string, unknown>).agentReview as object),
    findingSources: { ...authority, reviewers: ["unadopted-bot"] },
  };
  expect(() => parseGatePolicy(value)).toThrow(InvalidEvidenceError);
  delete value.findingSources;
  expect(() => parseGatePolicy(value)).toThrow(InvalidEvidenceError);
});

test("a scoped gate refuses a supplied review file before reading its content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forge-source-input-"));
  try {
    const file = path.join(root, "policy.json");
    await writeFile(file, JSON.stringify(scoped()));
    const result = await readGateInputs(
      {
        expectedRevision: null,
        policy: file,
        pullRequest: 12,
        receipts: [],
        repository: "example/project",
        reviewEvidence: path.join(root, "never-created.json"),
        runId: "test",
        state: path.join(root, "private-state"),
      },
      { FORGE_GITHUB_TOKEN: "fixture-token" },
      path.join(root, "workspace")
    );
    expect(result).toEqual({
      issues: [
        {
          message:
            "configured finding sources require collected review evidence",
          path: "--review-evidence",
        },
      ],
      valid: false,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
