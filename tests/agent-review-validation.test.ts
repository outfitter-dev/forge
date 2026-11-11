import { expect, test } from "bun:test";

import type { AgentReviewAttempt } from "../src/index.ts";
import { evaluateEvidence, validateEvidenceInput } from "../src/index.ts";
import {
  exhausted,
  finding,
  followUp,
  hostedAttempt,
  localAttempt,
  nativeResolution,
  passingFactsV2,
  passingGroupV2,
  policyV2,
} from "./agent-review-fixtures.ts";
import { at, passingFacts, passingGroup, policy } from "./evidence-fixtures.ts";

const invalid = (facts: unknown, requirements: unknown, path: string) => {
  const result = evaluateEvidence(facts, requirements);
  expect(result).toMatchObject({ eligible: false, status: "invalid" });
  if (result.status === "invalid") {
    expect(at(result.issues).path).toBe(path);
  }
};

const withAttempt = (patch: Record<string, unknown>, base = localAttempt()) => {
  const facts = passingFactsV2();
  return {
    ...facts,
    pullRequest: {
      ...facts.pullRequest,
      agentReviews: [{ ...base, ...patch }],
    },
  };
};

const ATTEMPT = "facts.pullRequest.agentReviews[0]";

test("version 1 evidence keeps its version 1 result and meaning", () => {
  const result = evaluateEvidence(passingFacts(), policy());
  expect(result).toMatchObject({ eligible: true, schemaVersion: 1 });
  expect(result).not.toHaveProperty("agentReview");
  // Version 1 still requires every listed provider: silence blocks.
  const silent = passingFacts();
  silent.pullRequest.agentReviews = [];
  expect(evaluateEvidence(silent, policy()).eligible).toBe(false);
  expect(evaluateEvidence(passingGroup(), policy())).toMatchObject({
    eligible: true,
    schemaVersion: 1,
  });
});

test("version 2 evidence is evaluated only under version 2 policy", () => {
  expect(evaluateEvidence(passingFactsV2(), policyV2())).toMatchObject({
    eligible: true,
    schemaVersion: 2,
  });
  expect(evaluateEvidence(passingGroupV2(), policyV2())).toMatchObject({
    eligible: true,
    schemaVersion: 2,
  });
  invalid(passingFactsV2(), policy(), "facts.schemaVersion");
  invalid(passingFacts(), policyV2(), "facts.schemaVersion");
  invalid(passingGroup(), policyV2(), "facts.schemaVersion");
});

test("relabeling a record never moves it to another version's rules", () => {
  // Downgrade: version 2 evidence presented as version 1.
  invalid(
    { ...passingFactsV2(), schemaVersion: 1 },
    policy(),
    "facts.pullRequest.reviewFindings"
  );
  const {
    reviewFindings: _ledger,
    reviewLadder: _ladder,
    ...downgraded
  } = passingFactsV2().pullRequest;
  invalid(
    { ...passingFactsV2(), pullRequest: downgraded, schemaVersion: 1 },
    policy(),
    "facts.pullRequest.agentReviews[0].attemptId"
  );
  // Upgrade: version 1 evidence presented as version 2.
  invalid(
    { ...passingFacts(), schemaVersion: 2 },
    policyV2(),
    "facts.pullRequest.agentReviews[0].blockingFindings"
  );
  invalid(
    passingFactsV2(),
    { ...policyV2(), schemaVersion: 1 },
    "policy.agentReview"
  );
  invalid(
    passingFacts(),
    { ...policy(), schemaVersion: 2 },
    "policy.requiredAgentProviders"
  );
  invalid(
    passingFactsV2(),
    { ...policyV2(), requiredAgentProviders: policy().requiredAgentProviders },
    "policy.requiredAgentProviders"
  );
  invalid(
    passingFactsV2(),
    { ...policyV2(), schemaVersion: 3 },
    "policy.schemaVersion"
  );
  invalid(
    { ...passingFactsV2(), schemaVersion: 3 },
    policyV2(),
    "facts.schemaVersion"
  );
});

test("only general-review evidence has a slot in this gate", () => {
  invalid(withAttempt({ kind: "tenet-shadow" }), policyV2(), `${ATTEMPT}.kind`);
  invalid(withAttempt({ kind: undefined }), policyV2(), `${ATTEMPT}.kind`);
});

test("reviewer identity is open configuration, not a closed list", () => {
  const requirements = policyV2();
  requirements.agentReview.reviewers.push({
    producer: "hosted-collector:fixture",
    reviewer: "another-hosted-reviewer",
    rung: "hosted",
    runtimeFingerprint: "8".repeat(64),
    waitSeconds: 60,
  });
  expect(evaluateEvidence(passingFactsV2(), requirements).eligible).toBe(true);
});

test.each<[string, Record<string, unknown>]>([
  ["verified", { verified: true }],
  ["trusted", { trusted: true }],
  ["provider", { provider: "self-hosted" }],
  ["blockingFindings", { blockingFindings: 0 }],
  ["completedAt", { completedAt: "2026-01-01T00:20:00Z" }],
])("an attempt cannot assert its own %s field", (key, patch) => {
  invalid(withAttempt(patch), policyV2(), `${ATTEMPT}.${key}`);
});

test("authority cannot be injected beside the review evidence", () => {
  const facts = passingFactsV2();
  invalid(
    { ...facts, pullRequest: { ...facts.pullRequest, humanOverride: true } },
    policyV2(),
    "facts.pullRequest.humanOverride"
  );
  facts.pullRequest.reviewLadder = exhausted();
  invalid(
    {
      ...facts,
      pullRequest: {
        ...facts.pullRequest,
        reviewLadder: { ...exhausted(), approvedBy: "maintainer" },
      },
    },
    policyV2(),
    "facts.pullRequest.reviewLadder.approvedBy"
  );
  invalid(
    {
      ...facts,
      pullRequest: {
        ...facts.pullRequest,
        reviewFindings: { findings: [], recorded: true, waived: true },
      },
    },
    policyV2(),
    "facts.pullRequest.reviewFindings.waived"
  );
});

test.each<[string, Partial<Record<keyof AgentReviewAttempt, unknown>>]>([
  ["attemptId", { attemptId: "" }],
  ["rung", { rung: "local-varied" }],
  ["reviewer", { reviewer: " local-cli" }],
  [
    "subject.headSha",
    { subject: { ...localAttempt().subject, headSha: "abc" } },
  ],
  [
    "provenance.runId",
    { provenance: { ...localAttempt().provenance, runId: "" } },
  ],
  ["model", { model: "" }],
  ["harness", { harness: undefined }],
  ["nativeRef", { nativeRef: 1 }],
  ["instructions.digest", { instructions: { digest: "abc", id: "x" } }],
  ["launch", { launch: "trusted" }],
  ["context", { context: "clean" }],
  ["state", { state: "timed_out" }],
  ["complete", { complete: 1 }],
  ["verdict", { verdict: "clean" }],
  ["findingIds", { findingIds: "none" }],
  ["findingIds[0]", { findingIds: [""] }],
])("a malformed attempt %s is invalid", (key, patch) => {
  invalid(withAttempt(patch), policyV2(), `${ATTEMPT}.${key}`);
});

test.each([
  "2026-01-01T00:15:00.000Z",
  "2026-01-01T00:15:00+00:00",
  "2026-01-01 00:15:00Z",
  "2026-02-30T00:15:00Z",
  "2026-01-01",
  1_767_226_500,
])("%p is not a whole-second UTC time", (startedAt) => {
  invalid(withAttempt({ startedAt }), policyV2(), `${ATTEMPT}.startedAt`);
});

test("attempt times must describe one preserved observation window", () => {
  invalid(
    withAttempt({ observedAt: "2026-01-01T00:14:59Z" }),
    policyV2(),
    `${ATTEMPT}.observedAt`
  );
  invalid(
    withAttempt({ deadlineAt: null }, hostedAttempt()),
    policyV2(),
    `${ATTEMPT}.deadlineAt`
  );
  invalid(
    withAttempt({ deadlineAt: "2026-01-01T00:00:00Z" }, hostedAttempt()),
    policyV2(),
    `${ATTEMPT}.deadlineAt`
  );
});

test("unavailable is its own state with a reason", () => {
  const unavailable = { state: "unavailable", verdict: "unknown" };
  invalid(withAttempt(unavailable), policyV2(), `${ATTEMPT}.unavailableReason`);
  invalid(
    withAttempt({ ...unavailable, unavailableReason: "busy" }),
    policyV2(),
    `${ATTEMPT}.unavailableReason`
  );
  invalid(
    withAttempt({ unavailableReason: "error" }),
    policyV2(),
    `${ATTEMPT}.unavailableReason`
  );
});

test("a timeout cannot be recorded before its deadline", () => {
  invalid(
    withAttempt({ observedAt: "2026-01-01T00:14:59Z" }, hostedAttempt()),
    policyV2(),
    `${ATTEMPT}.unavailableReason`
  );
  // A local attempt has no configured wait, so a timeout needs a deadline.
  invalid(
    withAttempt({
      state: "unavailable",
      unavailableReason: "timeout",
      verdict: "unknown",
    }),
    policyV2(),
    `${ATTEMPT}.unavailableReason`
  );
});

test.each([{ findingIds: null }, { findingIds: [] }])(
  "a failed verdict with %p is not a compliant record",
  ({ findingIds }) => {
    invalid(
      withAttempt({ findingIds, verdict: "failed" }),
      policyV2(),
      `${ATTEMPT}.findingIds`
    );
  }
);

const withLedger = (findings: unknown[]) => {
  const facts = passingFactsV2();
  return {
    ...facts,
    pullRequest: {
      ...facts.pullRequest,
      reviewFindings: { findings, recorded: true },
    },
  };
};

const ENTRY = "facts.pullRequest.reviewFindings.findings[0]";

test.each<[string, unknown]>([
  ["kind", { ...finding(), kind: "note" }],
  ["reviewer", { ...finding(), reviewer: "" }],
  ["id", { ...finding(), id: 7 }],
  ["attemptId", { ...finding(), attemptId: undefined }],
  ["nativeRef", { ...finding(), nativeRef: "" }],
  ["severity", { ...finding(), severity: "low" }],
  ["resolution", { ...finding(), resolution: true }],
  [
    "resolution.kind",
    { ...finding(), resolution: { ...followUp(), kind: "human" } },
  ],
  [
    "resolution.subject",
    {
      ...finding(),
      resolution: { ...nativeResolution(), subject: at([followUp()]) },
    },
  ],
  [
    "resolution.disposition",
    { ...finding(), resolution: { ...followUp(), disposition: "waived" } },
  ],
  [
    "resolution.attemptId",
    { ...finding(), resolution: { ...followUp(), attemptId: "" } },
  ],
  [
    "resolution.nativeRef",
    { ...finding(), resolution: { ...followUp(), nativeRef: "" } },
  ],
  [
    "resolution.provenance.producer",
    {
      ...finding(),
      resolution: { ...nativeResolution(), provenance: { producer: "" } },
    },
  ],
  [
    "resolution.resolvedBy",
    { ...finding(), resolution: { ...followUp(), resolvedBy: "author" } },
  ],
])("a malformed ledger entry %s is invalid", (key, entry) => {
  invalid(withLedger([entry]), policyV2(), `${ENTRY}.${key}`);
});

test("the ledger and ladder are required observations", () => {
  const facts = passingFactsV2();
  const { reviewLadder: _ladder, ...missingLadder } = facts.pullRequest;
  invalid(
    { ...facts, pullRequest: missingLadder },
    policyV2(),
    "facts.pullRequest.reviewLadder"
  );
  const { reviewFindings: _ledger, ...missingLedger } = facts.pullRequest;
  invalid(
    { ...facts, pullRequest: missingLedger },
    policyV2(),
    "facts.pullRequest.reviewFindings"
  );
  invalid(
    {
      ...facts,
      pullRequest: {
        ...facts.pullRequest,
        reviewFindings: { findings: [], recorded: "yes" },
      },
    },
    policyV2(),
    "facts.pullRequest.reviewFindings.recorded"
  );
  invalid(
    {
      ...facts,
      pullRequest: {
        ...facts.pullRequest,
        reviewLadder: { ...exhausted(), exhausted: "yes" },
      },
    },
    policyV2(),
    "facts.pullRequest.reviewLadder.exhausted"
  );
});

const REVIEWERS = "policy.agentReview.reviewers";

test("invalid reviewer policy never disables or defaults review", () => {
  const review = policyV2().agentReview;
  const [hosted, local] = review.reviewers;
  const cases: [unknown, string][] = [
    [undefined, "policy.agentReview"],
    [{ ...review, reviewers: [] }, REVIEWERS],
    [{ ...review, reviewers: [local, local] }, `${REVIEWERS}[1].reviewer`],
    [
      { ...review, reviewers: [{ ...local, rung: "cloud" }] },
      `${REVIEWERS}[0].rung`,
    ],
    [
      { ...review, reviewers: [{ ...hosted, waitSeconds: 0 }] },
      `${REVIEWERS}[0].waitSeconds`,
    ],
    [
      { ...review, reviewers: [{ ...hosted, waitSeconds: 1.5 }] },
      `${REVIEWERS}[0].waitSeconds`,
    ],
    [
      { ...review, reviewers: [{ ...hosted, waitSeconds: undefined }] },
      `${REVIEWERS}[0].waitSeconds`,
    ],
    [
      { ...review, reviewers: [{ ...local, waitSeconds: 60 }] },
      `${REVIEWERS}[0].waitSeconds`,
    ],
    [
      { ...review, reviewers: [{ ...local, provider: "devin" }] },
      `${REVIEWERS}[0].provider`,
    ],
    [
      { ...review, reviewers: [{ ...local, runtimeFingerprint: "abc" }] },
      `${REVIEWERS}[0].runtimeFingerprint`,
    ],
    [{ ...review, instructions: [] }, "policy.agentReview.instructions"],
    [
      { ...review, instructions: [{ id: "x" }] },
      "policy.agentReview.instructions[0].digest",
    ],
    [{ ...review, ladder: undefined }, "policy.agentReview.ladder"],
    [{ ...review, required: ["local-cli"] }, "policy.agentReview.required"],
  ];
  for (const [agentReview, path] of cases) {
    invalid(passingFactsV2(), { ...policyV2(), agentReview }, path);
  }
});

test("validation returns a detached version 2 snapshot", () => {
  const facts = passingFactsV2();
  const result = validateEvidenceInput(facts, policyV2());
  expect(result.valid).toBe(true);
  facts.pullRequest.agentReviews = [];
  if (result.valid) {
    expect(result.input.facts).not.toEqual(facts);
    expect(
      evaluateEvidence(result.input.facts, result.input.policy).eligible
    ).toBe(true);
  }
});
