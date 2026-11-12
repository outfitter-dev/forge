import { expect, test } from "bun:test";

import type { CheckReceipt, CheckSource } from "../src/check-types.ts";
import type {
  CheckEvidence,
  CheckReceiptExpectation,
  CheckReceiptRejectionCode,
  CheckState,
  PullRequestSubject,
} from "../src/index.ts";
import {
  evaluateEvidence,
  normalizeCheckReceipts,
  VERIFICATION_GATES,
} from "../src/index.ts";
import { passingFactsV2, policyV2 } from "./agent-review-fixtures.ts";
import { at, BASE, HEAD, REPOSITORY, subject } from "./evidence-fixtures.ts";

const OTHER = "d".repeat(40);

const source = (overrides: Partial<CheckSource> = {}): CheckSource => ({
  base: BASE,
  coverage: "tracked-and-nonignored-untracked",
  dirty: false,
  head: HEAD,
  indexDigest: "8".repeat(64),
  mergeBase: BASE,
  tree: "c".repeat(40),
  untracked: 0,
  worktreeDigest: "9".repeat(64),
  ...overrides,
});

/** A persisted, stable, passing run of the aggregate check on the fixture PR. */
const receipt = (overrides: Partial<CheckReceipt> = {}): CheckReceipt => ({
  admission: "started",
  cancellation: null,
  cause: "unclassified",
  check: { commandDigest: "f".repeat(64), id: "check" },
  completion: "observed",
  configAfter: "e".repeat(64),
  configBefore: "e".repeat(64),
  diagnostic: "command-passed",
  durationMs: 1200,
  evidence: "stable",
  exitCode: 0,
  finishedAt: "2026-01-01T00:00:02.000Z",
  kind: "forge-check",
  outcome: "passed",
  receiptId: "receipt-1",
  recording: { path: "/fixture/receipt.json", state: "persisted" },
  repository: REPOSITORY,
  runtime: { arch: "arm64", bun: "1.4.4", platform: "darwin" },
  schemaVersion: 1,
  signal: null,
  sourceAfter: source(),
  sourceBefore: source(),
  startedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const named = (id: string, overrides: Partial<CheckReceipt> = {}) =>
  receipt({
    check: { commandDigest: "f".repeat(64), id },
    receiptId: `receipt-${id}`,
    ...overrides,
  });

const expectation = (
  checks: CheckReceiptExpectation["checks"]
): CheckReceiptExpectation => ({
  checks,
  provenance: policyV2().verification,
  pullRequest: 1,
});

/** Forge's own mapping: one aggregate check satisfies every gate. */
const normalize = (...receipts: unknown[]) =>
  normalizeCheckReceipts(
    receipts,
    expectation({ build: "check", lint: "check", test: "check" })
  );

const states = (...receipts: unknown[]) =>
  normalize(...receipts).checks.map((item) => item.state);

/** The real evaluator's verdict on the fixture PR given these checks. */
const evaluate = (checks: CheckEvidence[]) => {
  const facts = passingFactsV2();
  facts.pullRequest.checks = checks;
  const result = evaluateEvidence(facts, policyV2());
  if (result.status !== "evaluated") {
    throw new Error(JSON.stringify(result.issues));
  }
  return {
    eligible: result.eligible,
    gates: VERIFICATION_GATES.map((name) =>
      at(result.gates.filter((item) => item.name === name))
    ),
  };
};

const codes = (checks: CheckEvidence[]) =>
  evaluate(checks).gates.map((item) => item.reasons.map((each) => each.code));

test("a passing aggregate receipt yields one passed result per gate", () => {
  expect(normalize(receipt())).toEqual({
    checks: VERIFICATION_GATES.map((name) => ({
      name,
      provenance: { ...policyV2().verification, runId: "receipt-1" },
      state: "passed",
      subject: subject(),
    })),
    rejected: [],
  });
});

test("the evaluator passes lint, test and build on a passing aggregate receipt", () => {
  const result = evaluate(normalize(receipt()).checks);
  expect(result.gates.map((item) => item.conclusion)).toEqual([
    "success",
    "success",
    "success",
  ]);
  expect(result.eligible).toBe(true);
});

test("each result owns its subject and provenance", () => {
  const { checks } = normalize(receipt());
  expect(at(checks, 0).subject).not.toBe(at(checks, 1).subject);
  expect(at(checks, 0).provenance).not.toBe(at(checks, 1).provenance);
});

test.each<
  [
    string,
    Partial<CheckSource>,
    Partial<CheckReceipt>,
    Partial<PullRequestSubject>,
  ]
>([
  ["head", { head: OTHER }, {}, { headSha: OTHER }],
  ["base", { base: OTHER }, {}, { baseSha: OTHER }],
  [
    "repository",
    {},
    { repository: "other/project" },
    { repository: "other/project" },
  ],
])(
  "a receipt for another %s keeps its own subject and cannot pass the evaluator",
  (_key, observed, overrides, expected) => {
    const { checks } = normalize(
      receipt({
        ...overrides,
        sourceAfter: source(observed),
        sourceBefore: source(observed),
      })
    );
    expect(checks.map((item) => [item.state, item.subject])).toEqual([
      ["passed", { ...subject(), ...expected }],
      ["passed", { ...subject(), ...expected }],
      ["passed", { ...subject(), ...expected }],
    ]);
    const result = evaluate(checks);
    expect(result.eligible).toBe(false);
    for (const gate of result.gates) {
      expect(gate.conclusion).toBe("failure");
      expect(gate.reasons).toContainEqual(
        expect.objectContaining({ code: "subject-mismatch" })
      );
    }
  }
);

test("no receipts yield no checks and the evaluator reports missing evidence", () => {
  expect(normalize()).toEqual({ checks: [], rejected: [] });
  expect(codes([])).toEqual([
    ["missing-evidence"],
    ["missing-evidence"],
    ["missing-evidence"],
  ]);
});

test("exit 0 with changed evidence is incomplete, never passed", () => {
  expect(states(receipt({ evidence: "changed" }))).toEqual([
    "incomplete",
    "incomplete",
    "incomplete",
  ]);
});

test.each<[string, Partial<CheckReceipt>, CheckState]>([
  ["failed", { exitCode: 1, outcome: "failed" }, "failed"],
  [
    "canceled",
    { cancellation: "SIGTERM", exitCode: 0, outcome: "canceled" },
    "canceled",
  ],
  [
    "not-run",
    { admission: "not-started", exitCode: null, outcome: "not-run" },
    "incomplete",
  ],
  [
    "unknown",
    { admission: "unknown", exitCode: null, outcome: "unknown" },
    "unknown",
  ],
  ["unknown completion with passed", { completion: "unknown" }, "unknown"],
  [
    "unknown completion with failed",
    { completion: "unknown", exitCode: 1, outcome: "failed" },
    "unknown",
  ],
])(
  "a %s outcome maps to its own state on every gate",
  (_name, overrides, state) => {
    expect(states(receipt(overrides))).toEqual([state, state, state]);
  }
);

test("one failing aggregate run fails all three gates", () => {
  const { checks } = normalize(receipt({ exitCode: 1, outcome: "failed" }));
  expect(codes(checks)).toEqual([
    ["check-not-passed"],
    ["check-not-passed"],
    ["check-not-passed"],
  ]);
});

test.each<[string, Partial<CheckReceipt>]>([
  ["a dirty tree", { sourceAfter: source({ dirty: true }) }],
  ["untracked files", { sourceAfter: source({ untracked: 2 }) }],
  ["a failed recording", { recording: { path: null, state: "failed" } }],
  ["an unknown admission", { admission: "unknown" }],
  ["a nonzero exit code", { exitCode: 1 }],
  ["a missing exit code", { exitCode: null }],
  ["unknown evidence stability", { evidence: "unknown" }],
  ["a cancellation request", { cancellation: "SIGINT" }],
  ["no finish time", { finishedAt: null }],
  ["a head that moved", { sourceBefore: source({ head: OTHER }) }],
  ["a tree that moved", { sourceBefore: source({ tree: OTHER }) }],
  ["a base that moved", { sourceBefore: source({ base: OTHER }) }],
  ["a base supplied only afterwards", { sourceBefore: source({ base: null }) }],
  [
    "changed working files",
    { sourceBefore: source({ worktreeDigest: "7".repeat(64) }) },
  ],
  [
    "a changed index",
    { sourceBefore: source({ indexDigest: "7".repeat(64) }) },
  ],
])("%s makes a passed outcome incomplete", (_name, overrides) => {
  expect(states(receipt(overrides))).toEqual([
    "incomplete",
    "incomplete",
    "incomplete",
  ]);
});

const without = (key: keyof CheckReceipt): unknown =>
  Object.fromEntries(
    Object.entries(receipt()).filter(([name]) => name !== key)
  );

test.each<[string, unknown, CheckReceiptRejectionCode]>([
  ["null", null, "malformed-receipt"],
  ["text", "forge-check", "malformed-receipt"],
  ["an array", [receipt()], "malformed-receipt"],
  ["an empty object", {}, "malformed-receipt"],
  ["another kind", { ...receipt(), kind: "other" }, "malformed-receipt"],
  [
    "another schema version",
    { ...receipt(), schemaVersion: 2 },
    "malformed-receipt",
  ],
  [
    "an unsupported outcome",
    { ...receipt(), outcome: "skipped" },
    "malformed-receipt",
  ],
  ["a missing outcome", without("outcome"), "malformed-receipt"],
  ["a missing repository", without("repository"), "malformed-receipt"],
  ["an empty receipt ID", { ...receipt(), receiptId: "" }, "malformed-receipt"],
  [
    "a source without a head",
    { ...receipt(), sourceAfter: { ...source(), head: undefined } },
    "malformed-receipt",
  ],
  [
    "a non-boolean dirty flag",
    { ...receipt(), sourceAfter: { ...source(), dirty: "false" } },
    "malformed-receipt",
  ],
  [
    "a receipt ID with surrounding space",
    { ...receipt(), receiptId: " receipt-1 " },
    "malformed-receipt",
  ],
  ["a null repository", receipt({ repository: null }), "repository-missing"],
  [
    "a repository that is not owner/name",
    receipt({ repository: "project" }),
    "repository-invalid",
  ],
  [
    "a repository with a path beyond owner/name",
    receipt({ repository: "example/project/extra" }),
    "repository-invalid",
  ],
  ["a null check", receipt({ check: null }), "check-unmapped"],
  ["an unmapped check ID", named("docs"), "check-unmapped"],
  ["no source before", receipt({ sourceBefore: null }), "source-missing"],
  ["no source after", receipt({ sourceAfter: null }), "source-missing"],
  [
    "a SHA-256 head",
    receipt({ sourceAfter: source({ head: "a".repeat(64) }) }),
    "head-invalid",
  ],
  [
    "an uppercase head",
    receipt({ sourceAfter: source({ head: "A".repeat(40) }) }),
    "head-invalid",
  ],
  [
    "a null base",
    receipt({ sourceAfter: source({ base: null }) }),
    "base-missing",
  ],
  [
    "an abbreviated base",
    receipt({ sourceAfter: source({ base: "b".repeat(7) }) }),
    "base-invalid",
  ],
])("%s is rejected without evidence", (_name, value, code) => {
  expect(normalize(value)).toEqual({
    checks: [],
    rejected: [{ code, index: 0 }],
  });
});

test("rejections carry the receipt's index and leave other receipts intact", () => {
  const result = normalize(
    receipt({ repository: null }),
    receipt(),
    "not a receipt",
    receipt({ sourceAfter: source({ base: null }) })
  );
  expect(result.rejected).toEqual([
    { code: "repository-missing", index: 0 },
    { code: "malformed-receipt", index: 2 },
    { code: "base-missing", index: 3 },
  ]);
  expect(result.checks.map((item) => item.name)).toEqual([
    ...VERIFICATION_GATES,
  ]);
});

test("two receipts for one check stay duplicated and the evaluator blocks", () => {
  const { checks, rejected } = normalize(
    receipt(),
    receipt({ receiptId: "receipt-2" })
  );
  expect(rejected).toEqual([]);
  expect(checks.map((item) => [item.name, item.provenance.runId])).toEqual([
    ["lint", "receipt-1"],
    ["test", "receipt-1"],
    ["build", "receipt-1"],
    ["lint", "receipt-2"],
    ["test", "receipt-2"],
    ["build", "receipt-2"],
  ]);
  expect(codes(checks)).toEqual([
    ["duplicate-evidence"],
    ["duplicate-evidence"],
    ["duplicate-evidence"],
  ]);
});

test("a mapping with separate check IDs routes each receipt to its gates", () => {
  const { checks, rejected } = normalizeCheckReceipts(
    [named("unit", { exitCode: 1, outcome: "failed" }), named("static")],
    expectation({ build: "static", lint: "static", test: "unit" })
  );
  expect(rejected).toEqual([]);
  expect(
    checks.map((item) => [item.name, item.provenance.runId, item.state])
  ).toEqual([
    ["test", "receipt-unit", "failed"],
    ["lint", "receipt-static", "passed"],
    ["build", "receipt-static", "passed"],
  ]);
  expect(
    evaluate(checks).gates.map((item) => [item.name, item.conclusion])
  ).toEqual([
    ["lint", "success"],
    ["test", "failure"],
    ["build", "success"],
  ]);
});

// The outcome decides on its own. A receipt that says the command did not pass
// is not passed because its exit code and cancellation look clean.
test.each<[CheckReceipt["outcome"], CheckState]>([
  ["failed", "failed"],
  ["canceled", "canceled"],
  ["not-run", "incomplete"],
  ["unknown", "unknown"],
])(
  "a %s outcome with exit 0 and no cancellation is still %s",
  (outcome, state) => {
    expect(states(receipt({ outcome }))).toEqual([state, state, state]);
  }
);

test.each<[string, Partial<CheckReceipt>]>([
  ["a dirty tree before the run", { sourceBefore: source({ dirty: true }) }],
  [
    "untracked files before the run",
    { sourceBefore: source({ untracked: 3 }) },
  ],
])("%s makes a passed outcome incomplete", (_name, overrides) => {
  expect(states(receipt(overrides))).toEqual([
    "incomplete",
    "incomplete",
    "incomplete",
  ]);
});

const sourceWithout = (key: keyof CheckSource): unknown =>
  Object.fromEntries(Object.entries(source()).filter(([name]) => name !== key));

test.each<keyof CheckSource>([
  "tree",
  "base",
  "worktreeDigest",
  "indexDigest",
  "untracked",
])("a receipt whose sources both lack %s is malformed", (key) => {
  const broken = sourceWithout(key);
  expect(
    normalize({ ...receipt(), sourceAfter: broken, sourceBefore: broken })
  ).toEqual({
    checks: [],
    rejected: [{ code: "malformed-receipt", index: 0 }],
  });
});

test("a receipt with no finish time field is malformed", () => {
  expect(normalize(without("finishedAt"))).toEqual({
    checks: [],
    rejected: [{ code: "malformed-receipt", index: 0 }],
  });
});

test("a malformed source before the run is reported, not thrown", () => {
  expect(normalize({ ...receipt(), sourceBefore: "clean" })).toEqual({
    checks: [],
    rejected: [{ code: "malformed-receipt", index: 0 }],
  });
});

test("results carry the pull request and provenance the caller supplied, and nothing else", () => {
  const wide = {
    producer: "verification:fixture",
    reviewer: "not-part-of-provenance",
    runId: "caller-run",
    runtimeFingerprint: "2".repeat(64),
  };
  const { checks } = normalizeCheckReceipts([receipt()], {
    checks: { build: "check", lint: "check", test: "check" },
    provenance: wide,
    pullRequest: 77,
  });
  expect(checks).toHaveLength(3);
  expect(
    checks.every(
      (item) => item.subject.kind === "pull_request" && item.subject.id === 77
    )
  ).toBe(true);
  expect(at(checks).provenance).toEqual({
    producer: "verification:fixture",
    runId: "receipt-1",
    runtimeFingerprint: "2".repeat(64),
  });
});
