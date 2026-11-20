import { expect, test } from "bun:test";

import type { MergeGroupFactsV2, PullRequestEvidenceV2 } from "../src/index.ts";
import {
  evaluateEvidence,
  normalizeCheckReceipts,
  VERIFICATION_GATES,
} from "../src/index.ts";
import {
  passingGroupV2,
  passingPrV2,
  policyV2,
} from "./agent-review-fixtures.ts";
import { receipt, source } from "./check-fixtures.ts";
import {
  at,
  BASE,
  HEAD,
  passingGroup,
  passingPr,
  policy,
  subject,
} from "./evidence-fixtures.ts";

const NEXT_BASE = "e".repeat(40);

const independentGroup = (baseSha = BASE) => {
  const facts = passingGroup();
  facts.members = [
    subject(1, "a".repeat(40), baseSha),
    subject(2, "d".repeat(40), baseSha),
  ];
  facts.admissions = facts.members.map((member) => {
    const admission = passingPr(member.id, member.headSha, member.baseSha);
    admission.assignments.requiredReviewers = ["human"];
    admission.humanReviews = [
      { reviewer: "human", state: "approved", subject: { ...member } },
    ];
    return admission;
  });
  facts.candidate.subject.baseSha = baseSha;
  facts.candidate.subject.headSha =
    baseSha === BASE ? "c".repeat(40) : "f".repeat(40);
  for (const check of facts.candidate.checks) {
    check.subject = { ...facts.candidate.subject };
    check.provenance.runId = `integration-${baseSha}`;
  }
  return facts;
};

test("fresh integration checks cannot refresh old-base independent PR admissions", () => {
  const original = independentGroup();
  expect(evaluateEvidence(original, policy()).eligible).toBe(true);
  const regenerated = independentGroup(NEXT_BASE);
  regenerated.admissions = original.admissions;
  const result = evaluateEvidence(regenerated, policy());
  expect(result.status).toBe("evaluated");
  expect(result.eligible).toBe(false);
  if (result.status === "evaluated") {
    for (const name of ["lint", "test", "build"]) {
      expect(result.gates.find((gate) => gate.name === name)?.conclusion).toBe(
        "success"
      );
    }
    for (const name of ["agent-review", "human-review", "mergeability"]) {
      const decision = result.gates.find((gate) => gate.name === name);
      expect(decision?.conclusion).toBe("failure");
      for (const index of [0, 1]) {
        expect(decision?.reasons).toContainEqual(
          expect.objectContaining({
            code: "subject-mismatch",
            path: `facts.admissions[${index}].subject.baseSha`,
          })
        );
      }
    }
  }
});

test.each(["checks", "agentReviews", "humanReviews"] as const)(
  "refreshing admission identity cannot relabel stale %s as new-base evidence",
  (field) => {
    const original = independentGroup();
    const refreshed = independentGroup(NEXT_BASE);
    const current = at(refreshed.admissions, 1);
    refreshed.admissions[1] = {
      ...current,
      [field]: at(original.admissions, 1)[field],
    };
    expect(evaluateEvidence(refreshed, policy()).eligible).toBe(false);
    refreshed.admissions[1] = current;
    expect(evaluateEvidence(refreshed, policy()).eligible).toBe(true);
  }
);

test("a voluntary objection remains blocking in a freshly qualified candidate", () => {
  const facts = independentGroup(NEXT_BASE);
  at(facts.admissions).humanReviews.push({
    reviewer: "volunteer",
    state: "changes_requested",
    subject: subject(),
  });
  const result = evaluateEvidence(facts, policy());
  expect(result.eligible).toBe(false);
  if (result.status === "evaluated") {
    expect(
      result.gates.find((gate) => gate.name === "human-review")?.reasons
    ).toContainEqual(expect.objectContaining({ code: "changes-requested" }));
  }
});

test("candidate base movement does not rewrite a stacked member's own base", () => {
  const facts = independentGroup();
  const stacked = subject(2, "d".repeat(40), at(facts.members).headSha);
  facts.members[1] = stacked;
  const admission = passingPr(stacked.id, stacked.headSha, stacked.baseSha);
  admission.assignments.requiredReviewers = ["human"];
  admission.humanReviews = [
    { reviewer: "human", state: "approved", subject: { ...stacked } },
  ];
  facts.admissions[1] = admission;
  expect(evaluateEvidence(facts, policy()).eligible).toBe(true);
  facts.candidate.subject.baseSha = NEXT_BASE;
  facts.candidate.subject.headSha = "f".repeat(40);
  for (const check of facts.candidate.checks) {
    check.subject = { ...facts.candidate.subject };
  }
  // A stacked member can retain its own target base. Only authoritative member
  // movement makes its admission stale; candidate movement is a separate fact.
  expect(evaluateEvidence(facts, policy()).eligible).toBe(true);
});

const LOWER_CANDIDATE = "c".repeat(40);
const UPPER_HEAD = "d".repeat(40);
const STACK_CANDIDATE = "e".repeat(40);
const REBASED_UPPER = "f".repeat(40);
const REFRESHED_CANDIDATE = "1".repeat(40);
const stackPolicy = policyV2();

const layerAdmission = (
  id: number,
  headSha: string,
  baseSha: string,
  passed = true
) => {
  const snapshot = source({ base: baseSha, head: headSha, mergeBase: baseSha });
  const verification = receipt({
    diagnostic: passed ? "command-passed" : "command-failed-unclassified",
    exitCode: passed ? 0 : 1,
    outcome: passed ? "passed" : "failed",
    receiptId: `check-${id}-${headSha}-${baseSha}`,
    sourceAfter: snapshot,
    sourceBefore: snapshot,
  });
  const { checks, rejected } = normalizeCheckReceipts([verification], {
    checks: { build: "check", lint: "check", test: "check" },
    provenance: stackPolicy.verification,
    pullRequest: id,
  });
  expect(rejected).toEqual([]);
  const admission = passingPrV2(id, headSha, baseSha);
  admission.assignments.requiredReviewers = ["human"];
  admission.humanReviews = [
    { reviewer: "human", state: "approved", subject: { ...admission.subject } },
  ];
  admission.checks = checks;
  return admission;
};

const stackCandidate = (
  headSha: string,
  baseSha: string,
  ...admissions: PullRequestEvidenceV2[]
): MergeGroupFactsV2 => {
  const facts = passingGroupV2();
  facts.admissions = admissions;
  facts.members = admissions.map((admission) => ({ ...admission.subject }));
  facts.candidate.subject = { ...facts.candidate.subject, baseSha, headSha };
  facts.candidate.checks = facts.candidate.checks.map((check) => ({
    ...check,
    provenance: { ...check.provenance, runId: `integration-${headSha}` },
    subject: { ...facts.candidate.subject },
  }));
  return facts;
};

const expectBlockedDespitePassingIntegration = (facts: MergeGroupFactsV2) => {
  const result = evaluateEvidence(facts, stackPolicy);
  if (result.status !== "evaluated") {
    throw new Error(JSON.stringify(result.issues));
  }
  expect(result.eligible).toBe(false);
  for (const name of VERIFICATION_GATES) {
    expect(result.gates.find((gate) => gate.name === name)?.conclusion).toBe(
      "success"
    );
  }
  const mergeability = at(
    result.gates.filter((gate) => gate.name === "mergeability")
  );
  expect(mergeability.conclusion).toBe("failure");
  return mergeability.reasons;
};

test("a lower-only candidate qualifies while a failing upper admission blocks the full stack", () => {
  const lower = layerAdmission(1, HEAD, BASE);
  const upper = layerAdmission(2, UPPER_HEAD, HEAD, false);
  const lowerOnly = stackCandidate(LOWER_CANDIDATE, BASE, lower);
  const fullStack = stackCandidate(STACK_CANDIDATE, BASE, lower, upper);

  expect(evaluateEvidence(lowerOnly, stackPolicy).eligible).toBe(true);
  expect(expectBlockedDespitePassingIntegration(fullStack)).toContainEqual(
    expect.objectContaining({
      code: "check-not-passed",
      path: "facts.admissions[1].checks[1].state",
    })
  );
});

test.each([
  ["unchanged", UPPER_HEAD],
  ["rebased", REBASED_UPPER],
])(
  "after simulated lower landing, an old-base receipt blocks the %s upper head",
  (_change, headSha) => {
    const lower = layerAdmission(1, HEAD, BASE);
    const oldUpper = layerAdmission(2, UPPER_HEAD, HEAD);
    expect(
      evaluateEvidence(
        stackCandidate(STACK_CANDIDATE, BASE, lower, oldUpper),
        stackPolicy
      ).eligible
    ).toBe(true);

    const currentUpper = layerAdmission(2, headSha, LOWER_CANDIDATE);
    const refreshed = stackCandidate(
      REFRESHED_CANDIDATE,
      LOWER_CANDIDATE,
      currentUpper
    );
    const stale = {
      ...refreshed,
      admissions: [{ ...currentUpper, checks: oldUpper.checks }],
    };
    const mismatches = expectBlockedDespitePassingIntegration(stale);
    expect(mismatches).toContainEqual(
      expect.objectContaining({
        code: "subject-mismatch",
        path: "facts.admissions[0].checks[1].subject.baseSha",
      })
    );
    if (headSha !== UPPER_HEAD) {
      expect(mismatches).toContainEqual(
        expect.objectContaining({
          code: "subject-mismatch",
          path: "facts.admissions[0].checks[1].subject.headSha",
        })
      );
    }
    expect(evaluateEvidence(refreshed, stackPolicy).eligible).toBe(true);
  }
);
