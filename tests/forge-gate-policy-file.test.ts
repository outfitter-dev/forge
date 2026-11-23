import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { readConfig } from "../src/check-config.ts";
import { parseGatePolicy } from "../src/gate-policy.ts";
import { evaluateEvidence, VERIFICATION_GATES } from "../src/index.ts";
import type { PullRequestFactsV2 } from "../src/index.ts";
import { hostedReport, passingPrV2 } from "./agent-review-fixtures.ts";
import { BASE, subject } from "./evidence-fixtures.ts";
import { codexPass } from "./gate-codex-fixtures.ts";
import { PULL_REQUEST, pullRequest, receipt, SERVED } from "./gate-fixtures.ts";
import {
  change,
  cleanupGateWorkspace,
  evaluated,
  gate,
  gateArgs,
  root,
  run,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";
import type { Workspace } from "./gate-test-harness.ts";

setDefaultTimeout(30_000);
afterEach(cleanupGateWorkspace);

const FORGE = "outfitter-dev/forge";
const POLICY_FILE = path.join(root, "forge-gate.json");

/**
 * Each lane role's producer and its descriptor, as docs/forge-gate.md states
 * them. A fingerprint is the SHA-256 of the descriptor's UTF-8 bytes.
 */
const ROLES = {
  collector: {
    descriptor: "forge-lane/collector@1",
    producer: "forge-lane:collector",
  },
  ladder: { descriptor: "forge-lane/ladder@1", producer: "forge-lane:ladder" },
  reviewer: {
    descriptor: "forge-lane/codex-github@1",
    producer: "forge-lane:codex-github",
  },
  verification: {
    descriptor: "forge-lane/verification@1",
    producer: "forge-lane:verification",
  },
};

const identity = (role: keyof typeof ROLES) => ({
  producer: ROLES[role].producer,
  runtimeFingerprint: createHash("sha256")
    .update(ROLES[role].descriptor)
    .digest("hex"),
});

/** The provenance of evidence a role issues under its documented identity. */
const issued = (role: keyof typeof ROLES) => ({
  ...identity(role),
  runId: "offline-run-1",
});

/** The committed file, read the way `forge gate` reads its `--policy`. */
const committed = () => {
  const value: unknown = JSON.parse(readFileSync(POLICY_FILE, "utf-8"));
  return parseGatePolicy(value);
};

test("each lane role is identified by its producer and the SHA-256 of its documented descriptor", () => {
  const { evidence } = committed();
  expect(evidence.collector).toStrictEqual(identity("collector"));
  expect(evidence.verification).toStrictEqual(identity("verification"));
  expect(evidence.agentReview).toMatchObject({
    ladder: identity("ladder"),
    reviewers: [identity("reviewer")],
  });
  // The file equals these, so distinct here is distinct in the file.
  const identities = [
    identity("collector"),
    identity("verification"),
    identity("reviewer"),
    identity("ladder"),
  ];
  expect(new Set(identities.map((item) => item.producer)).size).toBe(4);
  expect(new Set(identities.map((item) => item.runtimeFingerprint)).size).toBe(
    4
  );
});

test("the only eligible reviewer is the adopted hosted Codex entry, with a reserved ladder and no local guidance", () => {
  expect(committed().evidence.agentReview).toStrictEqual({
    instructions: [],
    ladder: identity("ladder"),
    reviewers: [
      {
        ...identity("reviewer"),
        reviewer: "codex-github",
        rung: "hosted",
        waitSeconds: 900,
      },
    ],
  });
});

test("the Codex collector policy is the adopted entry", () => {
  expect(committed().reviewAdapters[0]?.configuration).toStrictEqual({
    botAccountId: 199_175_422,
    findingHistory: "supplied-global-ledger",
    independence: {
      id: "forge/codex-github/2026-11-13",
      policyRevision: "linear-comment:ab87b5a1-593e-44e8-bd41-c109eb96265a",
      statement: "separate-hosted-invocation-without-inherited-author-context",
    },
    reviewer: "codex-github",
  });
});

test("the repository and every verification gate's check come from forge.json", async () => {
  const { config } = await readConfig(path.join(root, "forge.json"));
  const policy = committed();
  expect(policy.evidence.repository).toBe(config.repository);
  expect(policy.checks).toStrictEqual({
    build: config.check.id,
    lint: config.check.id,
    test: config.check.id,
  });
  expect(policy.mergeAuthorization).toStrictEqual({
    holdLabel: "forge:hold",
    rule: "same-repository-unless-held",
  });
});

test("the evaluator accepts the evidence policy and passes facts issued under its identities", () => {
  const reviewed = { ...subject(PULL_REQUEST), repository: FORGE };
  const facts: PullRequestFactsV2 = {
    event: "pull_request",
    pullRequest: {
      ...passingPrV2(),
      agentReviews: [
        hostedReport({
          provenance: issued("reviewer"),
          reviewer: "codex-github",
          subject: reviewed,
        }),
      ],
      checks: VERIFICATION_GATES.map((name) => ({
        name,
        provenance: issued("verification"),
        state: "passed",
        subject: reviewed,
      })),
      provenance: issued("collector"),
      subject: reviewed,
    },
    schemaVersion: 2,
  };
  expect(evaluateEvidence(facts, committed().evidence)).toMatchObject({
    eligible: true,
    status: "evaluated",
  });
});

/** A workspace whose ledger file is the one the command keeps for Forge's pull request. */
const forgeWorkspace = (): Workspace => {
  const ws = workspace();
  return {
    ...ws,
    ledgerFile: path.join(
      ws.ledgerDirectory,
      `outfitter-dev+forge+${PULL_REQUEST}.json`
    ),
  };
};

/** The real command, given the committed file as its policy and a clean Codex review to collect. */
const runCommitted = (review: unknown) => {
  const ws = forgeWorkspace();
  // The snapshot an earlier run recorded, which binds the review to its base.
  seedLedger(ws);
  const given = gateArgs(ws, {
    receipts: [receipt("check", { repository: FORGE })],
    review,
  });
  const args = change(
    change(given, "--policy", POLICY_FILE),
    "--repository",
    FORGE
  );
  // GitHub's answer names the repository, and the collector compares it.
  const served = pullRequest({
    base: {
      ref: "main",
      repo: { full_name: FORGE, id: 100, name: "forge" },
      sha: BASE,
    },
  });
  const collected = codexPass({ pullRequest: { body: served, date: SERVED } });
  return run(ws, args, { script: { passes: [collected] } });
};

test("forge gate evaluates under the committed policy and blocks on unknown findings when no ledger is supplied", () => {
  const ran = runCommitted(null);
  expect(ran.exitCode).toBe(1);
  expect(evaluated(ran).subject.repository).toBe(FORGE);
  // The collected Codex review is clean and credible; only the ledger is missing.
  expect(evaluated(ran).evaluation).toMatchObject({
    agentReview: [
      { disposition: "blocked", satisfiedBy: [expect.any(String)] },
    ],
  });
  expect(gate(ran, "agent-review").codes).toStrictEqual(["findings-unknown"]);
  for (const name of [...VERIFICATION_GATES, "human-review"] as const) {
    expect(gate(ran, name).codes).toStrictEqual([]);
  }
});

test("forge gate answers yes under the committed policy once a complete finding ledger is supplied", () => {
  const ran = runCommitted({
    agentReviews: [],
    reviewFindings: { findings: [], recorded: true },
    reviewLadder: null,
  });
  expect(ran.exitCode).toBe(0);
  expect(evaluated(ran).eligible).toBe(true);
});
