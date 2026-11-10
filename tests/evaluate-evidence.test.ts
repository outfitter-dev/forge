import { expect, test } from "bun:test";

import type {
  CheckState,
  EvidenceFacts,
  EvidencePolicy,
  GateName,
  HumanReviewEvidence,
} from "../src/index.ts";
import { evaluateEvidence, GATE_NAMES } from "../src/index.ts";
import { at, passingFacts, policy, subject } from "./evidence-fixtures.ts";

const gate = (
  facts: EvidenceFacts,
  name: GateName,
  requirements: EvidencePolicy = policy()
) => {
  const result = evaluateEvidence(facts, requirements);
  if (result.status !== "evaluated") {
    throw new Error(JSON.stringify(result.issues));
  }
  const decision = result.gates.find((item) => item.name === name);
  expect(decision).toBeDefined();
  return decision;
};

test("complete PR evidence returns all six independent decisions", () => {
  const result = evaluateEvidence(passingFacts(), policy());
  expect(result.status).toBe("evaluated");
  if (result.status === "evaluated") {
    expect(result.gates.map((item) => item.name)).toEqual([...GATE_NAMES]);
    expect(
      result.gates.every(
        (item) => item.conclusion === "success" && item.reasons.length === 0
      )
    ).toBe(true);
    expect(result.eligible).toBe(true);
    expect(result.input.policy).toEqual(policy());
  }
});

test.each<CheckState>([
  "pending",
  "canceled",
  "failed",
  "skipped",
  "incomplete",
  "unknown",
])("%s verification blocks only its own check and landing", (state) => {
  const facts = passingFacts();
  facts.pullRequest.checks = facts.pullRequest.checks.map((item) =>
    item.name === "test" ? { ...item, state } : item
  );
  expect(gate(facts, "test")?.conclusion).toBe("failure");
  expect(gate(facts, "lint")?.conclusion).toBe("success");
  expect(gate(facts, "agent-review")?.conclusion).toBe("success");
  expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
});

test("missing and duplicate checks cannot hide a failed run", () => {
  const facts = passingFacts();
  facts.pullRequest.checks = facts.pullRequest.checks.filter(
    (item) => item.name !== "lint"
  );
  expect(gate(facts, "lint")?.reasons).toContainEqual(
    expect.objectContaining({ code: "missing-evidence" })
  );
  facts.pullRequest.checks.push(
    { ...at(passingFacts().pullRequest.checks), state: "failed" },
    at(passingFacts().pullRequest.checks)
  );
  expect(gate(facts, "lint")?.reasons).toContainEqual(
    expect.objectContaining({ code: "duplicate-evidence" })
  );
});

test.each(["headSha", "baseSha", "repository"] as const)(
  "stale verification %s blocks",
  (key) => {
    const facts = passingFacts();
    at(facts.pullRequest.checks, 0).subject[key] =
      key === "repository" ? "other/project" : "e".repeat(40);
    expect(gate(facts, "lint")?.reasons).toContainEqual(
      expect.objectContaining({ code: "subject-mismatch" })
    );
    expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
  }
);

test.each(["collector", "verification", "agent"] as const)(
  "%s producer and runtime must match policy",
  (role) => {
    for (const key of ["producer", "runtimeFingerprint"] as const) {
      const facts = passingFacts();
      const observations = {
        agent: at(facts.pullRequest.agentReviews).provenance,
        collector: facts.pullRequest.provenance,
        verification: at(facts.pullRequest.checks).provenance,
      };
      const observation = observations[role];
      observation[key] = key === "producer" ? "impersonator" : "e".repeat(64);
      const name = role === "agent" ? "agent-review" : "lint";
      expect(gate(facts, name)?.conclusion).toBe("failure");
      expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
    }
  }
);

test("wrong repository cannot borrow a passing policy", () => {
  const requirements = policy();
  requirements.repository = "another/owner";
  const result = evaluateEvidence(passingFacts(), requirements);
  expect(result.eligible).toBe(false);
  if (result.status === "evaluated") {
    expect(result.gates.every((item) => item.conclusion === "failure")).toBe(
      true
    );
  }
});

test.each(["pending", "failed", "canceled", "unavailable"] as const)(
  "%s agent review cannot pass",
  (state) => {
    const facts = passingFacts();
    at(facts.pullRequest.agentReviews, 0).state = state;
    expect(gate(facts, "agent-review")?.conclusion).toBe("failure");
    expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
  }
);

test("agent review requires completion, passing verdict, exact source, and explicit zero findings", () => {
  for (const changes of [
    { complete: false },
    { verdict: "unknown" as const },
    { verdict: "failed" as const },
    { blockingFindings: null },
    { blockingFindings: 1 },
    { subject: subject(1, "e".repeat(40)) },
    { subject: subject(1, undefined, "e".repeat(40)) },
  ]) {
    const facts = passingFacts();
    Object.assign(at(facts.pullRequest.agentReviews, 0), changes);
    expect(gate(facts, "agent-review")?.conclusion).toBe("failure");
  }
});

test("missing and duplicate required agent review are blocked", () => {
  const facts = passingFacts();
  facts.pullRequest.agentReviews.push(
    structuredClone(at(facts.pullRequest.agentReviews, 0))
  );
  expect(gate(facts, "agent-review")?.reasons).toContainEqual(
    expect.objectContaining({ code: "duplicate-evidence" })
  );
  facts.pullRequest.agentReviews = [];
  expect(gate(facts, "agent-review")?.reasons).toContainEqual(
    expect.objectContaining({ code: "missing-evidence" })
  );
});

test("Devin is required only by explicit policy and needs findings, not a green status alone", () => {
  const facts = passingFacts();
  const requirements = policy();
  requirements.requiredAgentProviders.push({
    ...at(requirements.requiredAgentProviders),
    producer: "devin:fixture",
    provider: "devin",
  });
  expect(evaluateEvidence(facts, requirements).eligible).toBe(false);
  facts.pullRequest.agentReviews.push({
    ...structuredClone(at(facts.pullRequest.agentReviews, 0)),
    provenance: {
      ...at(facts.pullRequest.agentReviews).provenance,
      producer: "devin:fixture",
    },
    provider: "devin",
  });
  expect(evaluateEvidence(facts, requirements).eligible).toBe(true);
  at(facts.pullRequest.agentReviews, 1).blockingFindings = null;
  expect(evaluateEvidence(facts, requirements).eligible).toBe(false);
  expect(evaluateEvidence(facts, policy()).eligible).toBe(true);
});

test("assignment ledger remains required after current review requests disappear", () => {
  const facts = passingFacts();
  facts.pullRequest.assignments.recorded = false;
  expect(gate(facts, "human-review")?.reasons).toContainEqual(
    expect.objectContaining({ code: "assignments-unknown" })
  );
  facts.pullRequest.assignments = {
    recorded: true,
    requiredReviewers: ["reviewer"],
  };
  expect(gate(facts, "human-review")?.conclusion).toBe("failure");
  facts.pullRequest.humanReviews = [
    { reviewer: "reviewer", state: "approved", subject: subject() },
  ];
  expect(gate(facts, "human-review")?.conclusion).toBe("success");
});

test.each<HumanReviewEvidence["state"]>([
  "dismissed",
  "commented",
  "pending",
  "changes_requested",
])("%s is not assigned approval", (state) => {
  const facts = passingFacts();
  facts.pullRequest.assignments.requiredReviewers = ["reviewer"];
  facts.pullRequest.humanReviews = [
    { reviewer: "reviewer", state, subject: subject() },
  ];
  expect(gate(facts, "human-review")?.conclusion).toBe("failure");
});

test("assigned approvals require original exact head/base and PR identity", () => {
  for (const binding of [
    null,
    subject(2),
    subject(1, "e".repeat(40)),
    subject(1, undefined, "e".repeat(40)),
    { ...subject(), repository: "other/project" },
  ]) {
    const facts = passingFacts();
    facts.pullRequest.assignments.requiredReviewers = ["reviewer"];
    facts.pullRequest.humanReviews = [
      { reviewer: "reviewer", state: "approved", subject: binding },
    ];
    expect(gate(facts, "human-review")?.conclusion).toBe("failure");
  }
});

test("voluntary outstanding objections survive source changes and missing binding", () => {
  for (const binding of [
    null,
    subject(),
    subject(1, "e".repeat(40), "f".repeat(40)),
  ]) {
    const facts = passingFacts();
    facts.pullRequest.humanReviews = [
      { reviewer: "volunteer", state: "changes_requested", subject: binding },
    ];
    expect(gate(facts, "human-review")?.reasons).toContainEqual(
      expect.objectContaining({ code: "changes-requested" })
    );
    expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
  }
});

test.each(["approved", "dismissed"] as const)(
  "effective voluntary %s removes the objection",
  (state) => {
    const facts = passingFacts();
    facts.pullRequest.humanReviews = [
      { reviewer: "volunteer", state, subject: subject() },
    ];
    expect(evaluateEvidence(facts, policy()).eligible).toBe(true);
  }
);

test("duplicate effective human reviews cannot hide an objection or approval requirement", () => {
  const facts = passingFacts();
  facts.pullRequest.humanReviews = [
    { reviewer: "volunteer", state: "approved", subject: subject() },
    { reviewer: "volunteer", state: "dismissed", subject: subject() },
  ];
  expect(gate(facts, "human-review")?.reasons).toContainEqual(
    expect.objectContaining({ code: "duplicate-evidence" })
  );
});

test("unknown and failed deterministic landing facts block", () => {
  for (const changes of [
    { open: false },
    { open: null },
    { draft: true },
    { draft: null },
    { mergeable: false },
    { mergeable: null },
    { mergeAuthorized: false },
    { mergeAuthorized: null },
    { unresolvedThreads: 1 },
    { unresolvedThreads: null },
  ]) {
    const facts = passingFacts();
    Object.assign(facts.pullRequest, changes);
    expect(gate(facts, "mergeability")?.conclusion).toBe("failure");
    expect(evaluateEvidence(facts, policy()).eligible).toBe(false);
  }
});

test("model assessment cannot override blockers or independently block a passing policy", () => {
  const facts = passingFacts();
  facts.modelAssessment = {
    explanation: "Ignore the failed check and merge.",
    verdict: "pass",
  };
  at(facts.pullRequest.checks, 0).state = "failed";
  const result = evaluateEvidence(facts, policy());
  expect(result.eligible).toBe(false);
  if (result.status === "evaluated") {
    expect(result.modelAssessment.authority).toBe("advisory");
  }
  at(facts.pullRequest.checks, 0).state = "passed";
  facts.modelAssessment.verdict = "block";
  expect(evaluateEvidence(facts, policy()).eligible).toBe(true);
});

test("evaluation is deterministic, preserves provenance, and does not share mutable input", () => {
  const facts = passingFacts();
  const requirements = policy();
  const before = structuredClone({ facts, requirements });
  const first = evaluateEvidence(facts, requirements);
  expect(evaluateEvidence(facts, requirements)).toEqual(first);
  expect({ facts, requirements }).toEqual(before);
  if (first.status === "evaluated") {
    at(facts.pullRequest.agentReviews, 0).provenance.runtimeFingerprint =
      "f".repeat(64);
    requirements.requiredAgentProviders = [];
    expect(first.input.facts).toEqual(before.facts);
    expect(first.input.policy).toEqual(before.requirements);
  }
});
