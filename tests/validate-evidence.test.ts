import { expect, test } from "bun:test";

import { evaluateEvidence, validateEvidenceInput } from "../src/index.ts";
import { at, passingFacts, passingGroup, policy } from "./evidence-fixtures.ts";

const invalid = (
  facts: unknown,
  requirements: unknown = policy(),
  path?: string
) => {
  const result = evaluateEvidence(facts, requirements);
  expect(result).toMatchObject({ eligible: false, status: "invalid" });
  if (result.status === "invalid") {
    expect(result.issues.length).toBeGreaterThan(0);
    if (path) {
      expect(at(result.issues).path).toBe(path);
    }
  }
};

test.each(
  [null, undefined, [], "facts", 1, true, new Date()].map((value) => ({
    value,
  }))
)("rejects non-object facts %p", ({ value }) => {
  invalid(value);
});

test.each(
  [null, undefined, [], "policy", {}, true].map((value) => ({ value }))
)("rejects invalid policy %p", ({ value }) => {
  expect(evaluateEvidence(passingFacts(), value)).toMatchObject({
    eligible: false,
    status: "invalid",
  });
});

test("validates discriminants and rejects unsupported contract fields", () => {
  const facts = passingFacts();
  invalid({ ...facts, event: "push" }, policy(), "facts.event");
  invalid({ ...facts, schemaVersion: 2 }, policy(), "facts.schemaVersion");
  invalid({ ...facts, schemaVersion: 3 }, policy(), "facts.schemaVersion");
  invalid(facts, { ...policy(), schemaVersion: 3 }, "policy.schemaVersion");
  invalid({ ...facts, eligible: true }, policy(), "facts.eligible");
  invalid({ ...facts, members: [] });
  invalid({ ...passingGroup(), pullRequest: facts.pullRequest });
  invalid({
    ...facts,
    pullRequest: { ...facts.pullRequest, requestedReviewers: [] },
  });
});

test("invalid provider policy never disables review", () => {
  const requirement = at(policy().requiredAgentProviders);
  for (const providers of [
    undefined,
    null,
    [],
    [requirement, requirement],
    [{ ...requirement, provider: "unknown" }],
  ]) {
    invalid(passingFacts(), { ...policy(), requiredAgentProviders: providers });
  }
});

test.each(["", "abc123", "A".repeat(40), `${"a".repeat(39)}\n`, null, 1])(
  "rejects malformed source revision %p",
  (headSha) => {
    const facts = passingFacts();
    invalid({
      ...facts,
      pullRequest: {
        ...facts.pullRequest,
        subject: { ...facts.pullRequest.subject, headSha },
      },
    });
  }
);

test.each([
  "repository",
  "owner/repo/extra",
  "owner/",
  " owner/repo",
  "https://host/owner/repo",
])("rejects noncanonical repository %s", (repository) => {
  invalid(passingFacts(), { ...policy(), repository });
});

test.each([0, -1, 1.5, true, "1", Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid PR identity %p",
  (id) => {
    const facts = passingFacts();
    invalid({
      ...facts,
      pullRequest: {
        ...facts.pullRequest,
        subject: { ...facts.pullRequest.subject, id },
      },
    });
  }
);

test("missing observations and malformed containers remain distinguishable", () => {
  const facts = passingFacts();
  expect(
    evaluateEvidence(
      { ...facts, pullRequest: { ...facts.pullRequest, checks: [] } },
      policy()
    )
  ).toMatchObject({ eligible: false, status: "evaluated" });
  for (const checks of [undefined, null, {}, [null], [true]]) {
    invalid({ ...facts, pullRequest: { ...facts.pullRequest, checks } });
  }
});

test("malformed nested evidence and absent required facts fail closed", () => {
  const facts = passingFacts();
  const pr = facts.pullRequest;
  const malformed = [
    { assignments: undefined },
    { assignments: { recorded: true } },
    { assignments: { recorded: "true", requiredReviewers: [] } },
    { assignments: { recorded: true, requiredReviewers: [""] } },
    { humanReviews: {} },
    { humanReviews: [null] },
    { agentReviews: {} },
    { agentReviews: [null] },
    { mergeable: undefined },
    { mergeable: "true" },
    { provenance: undefined },
    { provenance: { ...pr.provenance, runId: "" } },
    { provenance: { ...pr.provenance, producer: "" } },
    {
      provenance: { ...pr.provenance, runtimeFingerprint: "not-a-fingerprint" },
    },
    { checks: [{ ...at(pr.checks), state: "success" }] },
    { checks: [{ ...at(pr.checks), state: undefined }] },
    { agentReviews: [{ ...at(pr.agentReviews), complete: undefined }] },
    { agentReviews: [{ ...at(pr.agentReviews), provider: "unknown" }] },
    { agentReviews: [{ ...at(pr.agentReviews), verdict: undefined }] },
    { humanReviews: [{ reviewer: "human", state: "unknown", subject: null }] },
  ];
  for (const changes of malformed) {
    invalid({ ...facts, pullRequest: { ...pr, ...changes } });
  }
});

test.each([
  undefined,
  false,
  true,
  -1,
  0.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
])("rejects malformed findings and thread counts %p", (count) => {
  const facts = passingFacts();
  const pr = facts.pullRequest;
  invalid({
    ...facts,
    pullRequest: {
      ...pr,
      agentReviews: [{ ...at(pr.agentReviews), blockingFindings: count }],
    },
  });
  invalid({ ...facts, pullRequest: { ...pr, unresolvedThreads: count } });
});

test("only the three verification check names enter the normalized contract", () => {
  const facts = passingFacts();
  invalid({
    ...facts,
    pullRequest: {
      ...facts.pullRequest,
      checks: [
        ...facts.pullRequest.checks,
        {
          ...at(facts.pullRequest.checks),
          name: "mergeability",
          state: "pending",
        },
      ],
    },
  });
});

test("invalid merge-group shapes and bindings cannot qualify", () => {
  const facts = passingGroup();
  invalid({ ...facts, members: undefined });
  invalid({ ...facts, admissions: {} });
  invalid({ ...facts, members: [{ ...at(facts.members), id: true }] });
  invalid({
    ...facts,
    candidate: {
      ...facts.candidate,
      subject: { ...facts.candidate.subject, id: 1 },
    },
  });
  invalid({
    ...facts,
    candidate: {
      ...facts.candidate,
      subject: { ...facts.candidate.subject, kind: "pull_request" },
    },
  });
});

test("model output cannot add an authority or override field", () => {
  invalid({
    ...passingFacts(),
    modelAssessment: {
      authority: "binding",
      eligible: true,
      explanation: "merge",
      verdict: "pass",
    },
  });
});

test("validation returns a typed detached snapshot, not authenticated evidence", () => {
  const facts = passingFacts();
  const result = validateEvidenceInput(facts, policy());
  expect(result.valid).toBe(true);
  if (result.valid) {
    facts.pullRequest.assignments.requiredReviewers.push("new-reviewer");
    expect(result.input.facts).not.toEqual(facts);
    expect(
      evaluateEvidence(result.input.facts, result.input.policy).eligible
    ).toBe(true);
  }
});

test("validation and evaluation use the same snapshot of changing property values", () => {
  const facts = passingFacts();
  let reads = 0;
  Object.defineProperty(at(facts.pullRequest.checks), "state", {
    enumerable: true,
    get: () => {
      reads += 1;
      return reads === 1 ? "failed" : "passed";
    },
  });
  expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
  expect(reads).toBe(1);
});

test("uncloneable input is invalid rather than an uncaught boundary failure", () => {
  invalid({ ...passingFacts(), modelAssessment: () => "merge" });
});
