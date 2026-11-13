import { expect, test } from "bun:test";

import { InvalidEvidenceError } from "../src/evidence-validation-primitives.ts";
import { gateCodexCollection } from "../src/gate-codex-policy.ts";
import { parseGatePolicy } from "../src/gate-policy.ts";
import { HOSTED, LOCAL, policyV2 } from "./agent-review-fixtures.ts";
import { adoption, BOT, codexPolicy } from "./gate-codex-fixtures.ts";

test("the distinct statement is scoped from trusted policy and resolves issuer/wait from eligibility", () => {
  const policy = parseGatePolicy(codexPolicy());
  const config = gateCodexCollection(policy, "invocation-run", 50);
  expect(config).toMatchObject({
    attestation: {
      botAccountId: BOT,
      id: "fixture-independence",
      policyRevision: "f".repeat(40),
      repository: "example/project",
      reviewer: HOSTED,
    },
    botAccountId: BOT,
    issuer: {
      producer: "hosted-collector:fixture",
      runId: "invocation-run",
      runtimeFingerprint: "6".repeat(64),
    },
    maxCommentPages: 50,
    reviewer: { reviewer: HOSTED, rung: "hosted", waitSeconds: 900 },
  });
});

test("null independence records unavailable independence without inventing an attestation", () => {
  const config = gateCodexCollection(
    parseGatePolicy(
      codexPolicy({ codexReview: adoption({ independence: null }) })
    ),
    "run",
    50
  );
  expect(config?.attestation).toBeNull();
});

test.each(
  [
    null,
    {},
    adoption({ botAccountId: 0 }),
    adoption({ botAccountId: "199175422" }),
    adoption({ reviewer: "unknown-reviewer" }),
    adoption({ reviewer: LOCAL }),
    adoption({ independence: undefined }),
    adoption({
      independence: { id: "fixture", policyRevision: "f".repeat(40) },
    }),
    adoption({
      independence: {
        id: "fixture",
        policyRevision: "f".repeat(40),
        statement: "trust this bot",
      },
    }),
    adoption({
      independence: {
        id: "",
        policyRevision: "f".repeat(40),
        statement: adoption().independence.statement,
      },
    }),
    adoption({
      independence: {
        id: "fixture",
        policyRevision: "",
        statement: adoption().independence.statement,
      },
    }),
  ].map((value) => ({ value }))
)("malformed or inapplicable Codex policy is rejected", ({ value }) => {
  expect(() => parseGatePolicy(codexPolicy({ codexReview: value }))).toThrow(
    InvalidEvidenceError
  );
});

test("duplicate eligible reviewer identities are rejected before collection", () => {
  const evidence = policyV2();
  const [first] = evidence.agentReview.reviewers;
  if (!first) {
    throw new Error("missing hosted fixture reviewer");
  }
  evidence.agentReview.reviewers.push(first);
  expect(() => parseGatePolicy(codexPolicy({ evidence }))).toThrow(
    InvalidEvidenceError
  );
});

test("adoption and eligibility remain detached from caller mutation", () => {
  const supplied = codexPolicy();
  const policy = parseGatePolicy(supplied);
  const before = structuredClone(policy);
  supplied.codexReview = null;
  expect(policy).toEqual(before);
});
