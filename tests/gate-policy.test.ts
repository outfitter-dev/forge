import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { InvalidEvidenceError } from "../src/evidence-validation-primitives.ts";
import { GATE_USAGE } from "../src/gate-arguments.ts";
import { parseGatePolicy } from "../src/gate-policy.ts";
import { evaluateEvidence, VERIFICATION_GATES } from "../src/index.ts";
import { passingFactsV2, policyV2 } from "./agent-review-fixtures.ts";
import { policy as policyV1 } from "./evidence-fixtures.ts";
import { gatePolicy, HOLD } from "./gate-fixtures.ts";

/** Stands for a value that must never be repeated in an issue. */
const MARKER = "private-policy-marker";

const issueOf = (value: unknown) => {
  try {
    parseGatePolicy(value);
  } catch (error) {
    if (error instanceof InvalidEvidenceError) {
      return error.issue;
    }
    throw error;
  }
  throw new Error("the policy was accepted");
};

/** The fixture policy with one part replaced. */
const withEvidence = (overrides: Record<string, unknown>) =>
  gatePolicy({ evidence: { ...policyV2(), ...overrides } });
const withChecks = (overrides: Record<string, unknown>) =>
  gatePolicy({
    checks: { build: "check", lint: "check", test: "check", ...overrides },
  });
const withAuthorization = (overrides: Record<string, unknown>) =>
  gatePolicy({
    mergeAuthorization: {
      holdLabel: HOLD,
      rule: "same-repository-unless-held",
      ...overrides,
    },
  });
const without = (value: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

test("a valid policy is returned whole", () => {
  expect<unknown>(parseGatePolicy(gatePolicy())).toStrictEqual({
    checks: { build: "check", lint: "check", test: "check" },
    evidence: policyV2(),
    kind: "forge-gate-policy",
    mergeAuthorization: {
      holdLabel: HOLD,
      rule: "same-repository-unless-held",
    },
    schemaVersion: 1,
  });
});

test("the result shares nothing with the value it was parsed from", () => {
  const checks = { build: "check", lint: "check", test: "check" };
  const evidence = policyV2();
  const mergeAuthorization = {
    holdLabel: HOLD,
    rule: "same-repository-unless-held",
  };
  const given = gatePolicy({ checks, evidence, mergeAuthorization });
  const parsed = parseGatePolicy(given);
  const copy = structuredClone(parsed);
  expect(parsed).not.toBe(given);
  given.kind = "changed";
  checks.lint = "changed";
  mergeAuthorization.holdLabel = "changed";
  evidence.repository = "changed/changed";
  evidence.collector.producer = "changed";
  evidence.verification.runtimeFingerprint = "changed";
  evidence.agentReview.reviewers.length = 0;
  expect(parsed).toStrictEqual(copy);
});

test("each gate may name its own check, and a hold label may hold a space", () => {
  const parsed = parseGatePolicy({
    ...withChecks({ build: "build", lint: "lint", test: "test" }),
    mergeAuthorization: {
      holdLabel: "do not land",
      rule: "same-repository-unless-held",
    },
  });
  expect(parsed.checks).toStrictEqual({
    build: "build",
    lint: "lint",
    test: "test",
  });
  expect(parsed.mergeAuthorization.holdLabel).toBe("do not land");
});

test("the evidence policy reaches the evaluator as it was given", () => {
  const { evidence } = parseGatePolicy(gatePolicy());
  expect(evaluateEvidence(passingFactsV2(), evidence)).toMatchObject({
    eligible: true,
    status: "evaluated",
  });
});

test("an evidence field this parser does not read is left for the evaluator to refuse", () => {
  const { evidence } = parseGatePolicy(withEvidence({ surprise: true }));
  expect(evidence.surprise).toBe(true);
  expect(evaluateEvidence(passingFactsV2(), evidence)).toMatchObject({
    issues: [{ path: "policy.surprise" }],
    status: "invalid",
  });
  const reviewers = parseGatePolicy(
    withEvidence({ agentReview: { reviewers: [] } })
  );
  expect(evaluateEvidence(passingFactsV2(), reviewers.evidence).status).toBe(
    "invalid"
  );
});

test.each<[string, unknown, string]>([
  ["null", null, "gatePolicy"],
  ["a list", [gatePolicy()], "gatePolicy"],
  ["text", MARKER, "gatePolicy"],
  [
    "another schema version",
    gatePolicy({ schemaVersion: 2 }),
    "gatePolicy.schemaVersion",
  ],
  [
    "a schema version as text",
    gatePolicy({ schemaVersion: "1" }),
    "gatePolicy.schemaVersion",
  ],
  [
    "no schema version",
    without(gatePolicy(), "schemaVersion"),
    "gatePolicy.schemaVersion",
  ],
  ["another kind", gatePolicy({ kind: MARKER }), "gatePolicy.kind"],
  ["no kind", without(gatePolicy(), "kind"), "gatePolicy.kind"],
  ["an unknown field", gatePolicy({ surprise: MARKER }), "gatePolicy.surprise"],
  ["no checks", without(gatePolicy(), "checks"), "gatePolicy.checks"],
  ["checks as a list", gatePolicy({ checks: [] }), "gatePolicy.checks"],
  [
    "an unknown check",
    withChecks({ surprise: MARKER }),
    "gatePolicy.checks.surprise",
  ],
  [
    "no mergeAuthorization",
    without(gatePolicy(), "mergeAuthorization"),
    "gatePolicy.mergeAuthorization",
  ],
  [
    "a hold label in place of mergeAuthorization",
    gatePolicy({ mergeAuthorization: HOLD }),
    "gatePolicy.mergeAuthorization",
  ],
  [
    "an unknown authorization field",
    withAuthorization({ surprise: MARKER }),
    "gatePolicy.mergeAuthorization.surprise",
  ],
  [
    "another rule",
    withAuthorization({ rule: MARKER }),
    "gatePolicy.mergeAuthorization.rule",
  ],
  [
    "no rule",
    gatePolicy({ mergeAuthorization: { holdLabel: HOLD } }),
    "gatePolicy.mergeAuthorization.rule",
  ],
  [
    "no hold label",
    gatePolicy({
      mergeAuthorization: { rule: "same-repository-unless-held" },
    }),
    "gatePolicy.mergeAuthorization.holdLabel",
  ],
  ["no evidence", without(gatePolicy(), "evidence"), "gatePolicy.evidence"],
  [
    "evidence as a list",
    gatePolicy({ evidence: [policyV2()] }),
    "gatePolicy.evidence",
  ],
  [
    "evidence of schema version 1",
    gatePolicy({ evidence: policyV1() }),
    "gatePolicy.evidence.schemaVersion",
  ],
  [
    "evidence without a repository",
    gatePolicy({ evidence: without({ ...policyV2() }, "repository") }),
    "gatePolicy.evidence.repository",
  ],
  [
    "a repository that is not owner/name",
    withEvidence({ repository: MARKER }),
    "gatePolicy.evidence.repository",
  ],
  [
    "evidence without a collector",
    gatePolicy({ evidence: without({ ...policyV2() }, "collector") }),
    "gatePolicy.evidence.collector",
  ],
  [
    "an unknown collector field",
    withEvidence({
      collector: { ...policyV2().collector, surprise: MARKER },
    }),
    "gatePolicy.evidence.collector.surprise",
  ],
  [
    "an empty collector producer",
    withEvidence({ collector: { ...policyV2().collector, producer: "" } }),
    "gatePolicy.evidence.collector.producer",
  ],
  [
    "a collector fingerprint that is not 64 hexadecimal characters",
    withEvidence({
      collector: { ...policyV2().collector, runtimeFingerprint: MARKER },
    }),
    "gatePolicy.evidence.collector.runtimeFingerprint",
  ],
  [
    "evidence without a verification producer",
    gatePolicy({ evidence: without({ ...policyV2() }, "verification") }),
    "gatePolicy.evidence.verification",
  ],
  [
    "an untrimmed verification producer",
    withEvidence({
      verification: { ...policyV2().verification, producer: ` ${MARKER}` },
    }),
    "gatePolicy.evidence.verification.producer",
  ],
  [
    "an uppercase verification fingerprint",
    withEvidence({
      verification: {
        ...policyV2().verification,
        runtimeFingerprint: "A".repeat(64),
      },
    }),
    "gatePolicy.evidence.verification.runtimeFingerprint",
  ],
])("%s is refused at its path", (_name, value, path) => {
  const issue = issueOf(value);
  expect(issue.path).toBe(path);
  expect(JSON.stringify(issue)).not.toContain(MARKER);
});

test.each(VERIFICATION_GATES)(
  "a %s check that is missing, empty, untrimmed or not text is refused",
  (gate) => {
    const path = `gatePolicy.checks.${gate}`;
    const checks = { build: "check", lint: "check", test: "check" };
    expect(issueOf(gatePolicy({ checks: without(checks, gate) })).path).toBe(
      path
    );
    for (const id of ["", ` ${MARKER}`, `${MARKER}\n`, 5, null, [MARKER]]) {
      const issue = issueOf(withChecks({ [gate]: id }));
      expect(issue.path).toBe(path);
      expect(JSON.stringify(issue)).not.toContain(MARKER);
    }
  }
);

test.each([
  "",
  " ",
  ` ${HOLD}`,
  `${HOLD} `,
  "forge\thold",
  `${HOLD}\u007F`,
  "straße",
  "café",
  5,
  { label: HOLD },
])("the hold label %p is refused", (holdLabel) => {
  const issue = issueOf(withAuthorization({ holdLabel }));
  expect(issue.path).toBe("gatePolicy.mergeAuthorization.holdLabel");
  expect(issue.message).not.toContain("straße");
  expect(issue.message).not.toContain("café");
});

/** Every JSON example in the command's contract, in order: the policy, then the outputs. */
const documented = (): unknown[] =>
  [
    ...readFileSync(
      new URL("../docs/forge-gate.md", import.meta.url),
      "utf-8"
    ).matchAll(/```json\n(?<example>.*?)```/gsu),
  ].map((match) => JSON.parse(match.groups?.example ?? ""));

test("the documented policy is a valid policy whose evidence the evaluator accepts", () => {
  const [example] = documented();
  const { evidence } = parseGatePolicy(example);
  expect(evaluateEvidence(passingFactsV2(), evidence).status).toBe("evaluated");
});

test("the documented outputs are forge-gate documents, and the usage line is the command's", () => {
  const [, ...outputs] = documented();
  expect(outputs).toMatchObject([
    { status: "evaluated" },
    { stage: "collection", status: "not-collected" },
    { stage: "ledger-store", status: "not-collected" },
    { status: "invalid-input", usage: GATE_USAGE },
    { status: "invalid-input" },
  ]);
  for (const output of outputs) {
    expect(output).toMatchObject({ kind: "forge-gate", schemaVersion: 1 });
  }
});
