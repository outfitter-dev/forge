import { expect, test } from "bun:test";

import { evaluateEvidence } from "../src/index.ts";
import {
  at,
  passingGroup,
  passingPr,
  policy,
  subject,
} from "./evidence-fixtures.ts";

test("merge group requires both candidate integration and member admission evidence", () => {
  const facts = passingGroup();
  expect(evaluateEvidence(facts, policy()).eligible).toBe(true);
  at(at(facts.admissions).checks, 1).state = "failed";
  const result = evaluateEvidence(facts, policy());
  expect(result.eligible).toBe(false);
  if (result.status === "evaluated") {
    expect(result.gates.find((item) => item.name === "test")?.conclusion).toBe(
      "success"
    );
    expect(
      result.gates.find((item) => item.name === "mergeability")?.reasons
    ).toContainEqual(
      expect.objectContaining({
        code: "check-not-passed",
        path: "facts.admissions[0].checks[1].state",
      })
    );
  }
});

test("multiple members qualify only when every member has current admission", () => {
  const facts = passingGroup();
  facts.members.push(subject(2, "d".repeat(40)));
  facts.admissions.push(passingPr(2, "d".repeat(40)));
  facts.admissions.reverse();
  expect(evaluateEvidence(facts, policy()).eligible).toBe(true);
  at(facts.admissions).mergeAuthorized = false;
  expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
});

test("PR checks cannot substitute for candidate checks, even at identical head/base", () => {
  const facts = passingGroup();
  facts.candidate.subject.headSha = at(facts.members).headSha;
  facts.candidate.checks = structuredClone(at(facts.admissions).checks);
  const result = evaluateEvidence(facts, policy());
  expect(result.eligible).toBe(false);
  if (result.status === "evaluated") {
    expect(
      result.gates.find((item) => item.name === "lint")?.reasons
    ).toContainEqual(
      expect.objectContaining({
        code: "subject-mismatch",
        path: "facts.candidate.checks[0].subject.kind",
      })
    );
  }
});

test("candidate checks cannot substitute for member admission checks", () => {
  const facts = passingGroup();
  at(facts.admissions).checks = structuredClone(facts.candidate.checks);
  expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
});

test.each(["headSha", "baseSha"] as const)(
  "candidate checks with stale %s block",
  (key) => {
    const facts = passingGroup();
    at(facts.candidate.checks).subject[key] = "e".repeat(40);
    expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
  }
);

test("missing, extra, and duplicate membership cannot be accepted", () => {
  const cases = [
    { admissions: [], members: [] },
    { admissions: [], members: [subject()] },
    { admissions: [passingPr()], members: [subject(), subject(2)] },
    { admissions: [passingPr(), passingPr()], members: [subject(), subject()] },
    { admissions: [passingPr(), passingPr()], members: [subject()] },
    { admissions: [passingPr(), passingPr(2)], members: [subject()] },
  ];
  for (const membership of cases) {
    const facts = { ...passingGroup(), ...membership };
    const result = evaluateEvidence(facts, policy());
    expect(result.eligible).toBe(false);
    if (result.status === "evaluated") {
      for (const name of ["agent-review", "human-review", "mergeability"]) {
        expect(
          result.gates.find((item) => item.name === name)?.reasons
        ).toContainEqual(
          expect.objectContaining({ code: "membership-mismatch" })
        );
      }
    }
  }
});

test.each(["headSha", "baseSha", "repository"] as const)(
  "self-consistent admission cannot substitute for authoritative member %s",
  (key) => {
    const facts = passingGroup();
    at(facts.members)[key] =
      key === "repository" ? "another/project" : "e".repeat(40);
    expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
  }
);

test("reviews belong to member revisions rather than the candidate", () => {
  const facts = passingGroup();
  at(facts.admissions).assignments.requiredReviewers = ["human"];
  at(facts.admissions).humanReviews = [
    { reviewer: "human", state: "approved", subject: subject() },
  ];
  expect(evaluateEvidence(facts, policy()).eligible).toBe(true);
  at(at(facts.admissions).agentReviews).subject.headSha =
    facts.candidate.subject.headSha;
  expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
});

test("outstanding voluntary member objections block the candidate", () => {
  const facts = passingGroup();
  at(facts.admissions).humanReviews = [
    { reviewer: "volunteer", state: "changes_requested", subject: null },
  ];
  expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
});

test.each(["candidate", "admission"] as const)(
  "%s repository and trusted collection runtime are enforced",
  (location) => {
    for (const field of ["repository", "runtimeFingerprint"] as const) {
      const facts = passingGroup();
      const record =
        location === "candidate" ? facts.candidate : at(facts.admissions);
      if (field === "repository") {
        record.subject.repository = "another/project";
      } else {
        record.provenance.runtimeFingerprint = "e".repeat(64);
      }
      expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
    }
  }
);

test("candidate review-shaped fields cannot waive missing member reviews", () => {
  const facts = passingGroup();
  at(facts.admissions).agentReviews = [];
  expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
  expect(
    evaluateEvidence(
      {
        ...facts,
        candidate: {
          ...facts.candidate,
          agentReviews: passingPr().agentReviews,
        },
      },
      policy()
    ).status
  ).toBe("invalid");
});
