import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { configuredFindingInventory } from "../src/configured-finding-inventory.ts";
import { evaluateEvidence } from "../src/evaluate-evidence.ts";
import type { FindingCoverage } from "../src/evidence-types.ts";
import { parseFindingSourcesPolicy } from "../src/finding-source-policy.ts";
import { emptyReviewLedgerEntry } from "../src/review-ledger-entry.ts";
import { parseStoredFindings } from "../src/review-ledger-findings.ts";
import {
  readReviewLedger,
  replaceReviewLedger,
} from "../src/review-ledger-store.ts";
import { finding, passingFactsV2, policyV2 } from "./agent-review-fixtures.ts";

const fixture = () => {
  const facts = passingFactsV2();
  const policy = policyV2();
  const sources = parseFindingSourcesPolicy({
    policyRevision: "a".repeat(40),
    resolution: "github-native",
    sources: [
      {
        accountId: 123,
        actorType: "Bot",
        externalCoverage: "qualified",
        formats: ["github-thread-v1"],
        qualificationRef: "fixture://qualified-reporter",
        reviewer: "reporter",
        surfaces: ["review", "issue-comment", "thread-comment"],
      },
    ],
    unqualifiedSources: [],
  });
  policy.agentReview.findingSources = {
    policyDigest: sources.policyDigest,
    policyRevision: sources.policyRevision,
    reviewers: ["reporter"],
    sourceAccounts: [
      { accountId: 123, actorType: "Bot", reviewer: "reporter" },
    ],
  };
  const observation = { comments: [], reviews: [], threads: [] };
  facts.pullRequest.reviewFindings = configuredFindingInventory({
    findings: { findings: [], recorded: false },
    first: observation,
    issuer: facts.pullRequest.provenance,
    policy: sources,
    second: observation,
    subject: facts.pullRequest.subject,
  }).reviewFindings;
  const { coverage } = facts.pullRequest.reviewFindings;
  if (coverage === undefined) {
    throw new Error("missing fixture coverage");
  }
  return { coverage, facts, policy };
};

test("fresh scoped coverage identifies its exact evaluated subject and collector run", () => {
  const { coverage, facts, policy } = fixture();
  expect(coverage.subject).toEqual(facts.pullRequest.subject);
  expect(coverage.provenance).toEqual(facts.pullRequest.provenance);
  expect(evaluateEvidence(facts, policy)).toMatchObject({
    eligible: true,
    status: "evaluated",
  });
});

test.each([
  { baseSha: "c".repeat(40) },
  { headSha: "d".repeat(40) },
  { id: 99 },
  { repository: "other/repository" },
])("coverage from another subject leaves findings unknown (%p)", (changes) => {
  const { coverage, facts, policy } = fixture();
  coverage.subject = { ...facts.pullRequest.subject, ...changes };
  const result = evaluateEvidence(facts, policy);
  expect(result).toMatchObject({ eligible: false, status: "evaluated" });
  if (result.status !== "evaluated") {
    throw new Error(JSON.stringify(result));
  }
  expect(
    result.gates
      .find((gate) => gate.name === "agent-review")
      ?.reasons.map((reason) => reason.code)
  ).toContain("findings-unknown");
});

test.each([
  { producer: "other-collector" },
  { runId: "previous-run" },
  { runtimeFingerprint: "f".repeat(64) },
])(
  "coverage from another collector observation leaves findings unknown (%p)",
  (changes) => {
    const { coverage, facts, policy } = fixture();
    coverage.provenance = { ...facts.pullRequest.provenance, ...changes };
    expect(evaluateEvidence(facts, policy)).toMatchObject({
      eligible: false,
      status: "evaluated",
    });
  }
);

test.each(["subject", "provenance", "both"] as const)(
  "historical coverage missing %s retains findings and supplies no completeness",
  (missing) => {
    const { coverage, facts, policy } = fixture();
    if (missing !== "provenance") {
      delete coverage.subject;
    }
    if (missing !== "subject") {
      delete coverage.provenance;
    }
    facts.pullRequest.reviewFindings.findings = [finding()];
    expect(
      parseStoredFindings(facts.pullRequest.reviewFindings).findings
    ).toEqual([finding()]);
    const result = evaluateEvidence(facts, policy);
    expect(result).toMatchObject({ eligible: false, status: "evaluated" });
    if (result.status !== "evaluated") {
      throw new Error(JSON.stringify(result));
    }
    expect(
      result.gates
        .find((gate) => gate.name === "agent-review")
        ?.reasons.map((reason) => reason.code)
    ).toContain("findings-unknown");
  }
);

test("scoped subject and collector binding survives ledger CAS and readback", async () => {
  const { facts } = fixture();
  const root = await mkdtemp(path.join(tmpdir(), "forge-coverage-binding-"));
  const location = {
    directory: root,
    pullRequest: facts.pullRequest.subject.id,
    repository: facts.pullRequest.subject.repository,
  };
  try {
    const previous = emptyReviewLedgerEntry();
    const next = {
      ...previous,
      reviewFindings: facts.pullRequest.reviewFindings,
    };
    expect(await replaceReviewLedger(location, previous, next)).toBe("stored");
    const saved = await readReviewLedger({
      ...location,
      now: "2999-01-01T00:00:00Z",
    });
    expect(saved.reviewFindings).toEqual(next.reviewFindings);
    const newer = {
      ...saved,
      reviewFindings: {
        ...saved.reviewFindings,
        coverage: {
          ...(saved.reviewFindings.coverage as FindingCoverage),
          provenance: { ...facts.pullRequest.provenance, runId: "new-run" },
        },
      },
    };
    expect(await replaceReviewLedger(location, saved, newer)).toBe("stored");
    expect(await replaceReviewLedger(location, saved, next)).toBe("conflict");
    const final = await readReviewLedger({
      ...location,
      now: "2999-01-01T00:00:00Z",
    });
    expect(final.reviewFindings.coverage?.provenance?.runId).toBe("new-run");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
