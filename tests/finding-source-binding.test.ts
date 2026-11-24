import { expect, test } from "bun:test";

import type {
  FindingCoverage,
  LegacyFindingSourceBinding,
  ReviewFinding,
} from "../src/evidence-types.ts";
import { boundFindingReportingSource } from "../src/finding-source-binding.ts";
import { evaluateLedger } from "../src/review-finding-ledger.ts";
import { passingPrV2, policyV2 } from "./agent-review-fixtures.ts";

const fixture = () => {
  const pr = passingPrV2();
  const policy = policyV2().agentReview;
  const account = {
    accountId: 123,
    actorType: "Bot" as const,
    reviewer: "legacy-codex",
  };
  policy.findingSources = {
    policyDigest: "a".repeat(64),
    policyRevision: "b".repeat(40),
    reviewers: [account.reviewer],
    sourceAccounts: [account],
  };
  const origin = {
    attemptId: "codex/original-observation",
    id: "native-thread",
    kind: "finding" as const,
    nativeRef: "native-thread",
    reviewer: account.reviewer,
  };
  const binding: LegacyFindingSourceBinding = {
    ...origin,
    reportingSource: {
      accountId: account.accountId,
      actorType: account.actorType,
    },
  };
  const coverage: FindingCoverage = {
    legacySources: [binding],
    policyDigest: policy.findingSources.policyDigest,
    policyRevision: policy.findingSources.policyRevision,
    provenance: pr.provenance,
    references: ["fixture://current-legacy-observation"],
    sourceAccounts: [account],
    subject: pr.subject,
  };
  const finding: ReviewFinding = {
    ...origin,
    resolution: {
      kind: "configured-native",
      nativeRef: origin.nativeRef,
      policyDigest: coverage.policyDigest,
      policyRevision: coverage.policyRevision,
      provenance: pr.provenance,
    },
  };
  pr.reviewFindings = { coverage, findings: [finding], recorded: true };
  const evaluate = () =>
    evaluateLedger(
      { credible: new Set(pr.agentReviews), policy, pr },
      "findings"
    );
  return { binding, coverage, evaluate, finding };
};

test("a current exact Codex legacy binding accepts native resolution without rewriting origin", () => {
  const { coverage, evaluate, finding } = fixture();
  expect(boundFindingReportingSource(finding, coverage)).toEqual({
    accountId: 123,
    actorType: "Bot",
  });
  expect(evaluate().blockers).toEqual([]);
  expect(finding.reportingSource).toBeUndefined();
});

test.each([
  "missing",
  "different-actor",
  "different-origin",
  "duplicate",
  "unattributed-attempt",
  "legacy-resolution",
] as const)("legacy binding refuses unproved attribution (%s)", (mode) => {
  const { binding, coverage, evaluate, finding } = fixture();
  if (mode === "missing") {
    delete coverage.legacySources;
  }
  if (mode === "different-actor") {
    binding.reportingSource.accountId = 456;
  }
  if (mode === "different-origin") {
    binding.attemptId = "codex/different-observation";
  }
  if (mode === "duplicate") {
    coverage.legacySources = [binding, structuredClone(binding)];
  }
  if (mode === "unattributed-attempt") {
    finding.attemptId = "arbitrary-provider/original-observation";
    binding.attemptId = finding.attemptId;
  }
  if (mode === "legacy-resolution") {
    finding.resolution = {
      kind: "native",
      nativeRef: finding.nativeRef,
      provenance: {
        producer: "legacy-provider",
        runId: "old-run",
        runtimeFingerprint: "f".repeat(64),
      },
    };
  }
  expect(evaluate().blockers.map((reason) => reason.code)).toContain(
    "blocking-findings"
  );
});
