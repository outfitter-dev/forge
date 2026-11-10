import type { Problems } from "./evidence-gates.ts";
import {
  bindingProblems,
  collectionProblems,
  evaluatePullRequest,
  reason,
  verificationProblems,
} from "./evidence-gates.ts";
import type { EvaluationResult } from "./evidence-types.ts";
import { GATE_NAMES, VERIFICATION_GATES } from "./evidence-types.ts";
import { validateEvidenceInput } from "./validate-evidence.ts";

/** Pure facts/policy evaluation. Always validates the external shape before deciding. */
export const evaluateEvidence = (
  facts: unknown,
  policy: unknown
): EvaluationResult => {
  const validation = validateEvidenceInput(facts, policy);
  if (!validation.valid) {
    return { eligible: false, issues: validation.issues, status: "invalid" };
  }
  const { input } = validation;
  const normalized = input.facts;
  const requirements = input.policy;
  const problems: Problems = {
    "agent-review": [],
    build: [],
    "human-review": [],
    lint: [],
    mergeability: [],
    test: [],
  };
  if (normalized.event === "pull_request") {
    evaluatePullRequest(
      normalized.pullRequest,
      requirements,
      "facts.pullRequest",
      problems,
      false
    );
  } else {
    const common = collectionProblems(
      normalized.candidate.subject,
      normalized.candidate.provenance,
      requirements,
      "facts.candidate"
    );
    for (const name of GATE_NAMES) {
      problems[name].push(...common);
    }
    for (const name of VERIFICATION_GATES) {
      problems[name].push(
        ...verificationProblems(
          normalized.candidate.checks,
          normalized.candidate.subject,
          name,
          requirements,
          "facts.candidate.checks"
        )
      );
    }
    const ids = normalized.members.map((member) => member.id);
    const admissions = normalized.admissions.map((pr) => pr.subject.id);
    const membershipMatches =
      ids.length > 0 &&
      new Set(ids).size === ids.length &&
      new Set(admissions).size === admissions.length &&
      ids.length === admissions.length &&
      ids.every((id) => admissions.includes(id));
    if (!membershipMatches) {
      for (const name of [
        "agent-review",
        "human-review",
        "mergeability",
      ] as const) {
        problems[name].push(
          reason(
            "membership-mismatch",
            "facts.members",
            "candidate requires exact, nonempty, unique member admissions"
          )
        );
      }
    }
    for (const [index, pr] of normalized.admissions.entries()) {
      const path = `facts.admissions[${index}]`;
      const member = normalized.members.find(
        (item) => item.id === pr.subject.id
      );
      if (member) {
        const binding = bindingProblems(pr.subject, member, `${path}.subject`);
        for (const name of [
          "agent-review",
          "human-review",
          "mergeability",
        ] as const) {
          problems[name].push(...binding);
        }
      }
      evaluatePullRequest(pr, requirements, path, problems, true);
    }
  }
  for (const name of GATE_NAMES) {
    if (name !== "mergeability" && problems[name].length > 0) {
      problems.mergeability.push(
        reason("gate-blocked", `gates.${name}`, `${name} gate has not passed`)
      );
    }
  }
  return {
    eligible: problems.mergeability.length === 0,
    gates: GATE_NAMES.map((name) => ({
      conclusion: problems[name].length ? "failure" : "success",
      name,
      reasons: problems[name],
    })),
    input,
    modelAssessment: {
      assessment: normalized.modelAssessment ?? null,
      authority: "advisory",
    },
    schemaVersion: 1,
    status: "evaluated",
  };
};
