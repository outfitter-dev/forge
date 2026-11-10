import { expect, test } from "bun:test";

import { evaluateEvidence } from "../src/index.ts";
import {
  at,
  BASE,
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
