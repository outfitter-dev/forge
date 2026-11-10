import type {
  CheckEvidence,
  EvidencePolicy,
  GateName,
  GateReason,
  ProducerPolicy,
  Provenance,
  PullRequestEvidence,
  Subject,
} from "./evidence-types.ts";
import { VERIFICATION_GATES } from "./evidence-types.ts";

export type Problems = Record<GateName, GateReason[]>;

export const reason = (
  code: GateReason["code"],
  path: string,
  message: string
): GateReason => ({
  code,
  message,
  path,
});

export const bindingProblems = (
  actual: Subject,
  expected: Subject,
  path: string
): GateReason[] => {
  const problems: GateReason[] = [];
  for (const key of ["kind", "repository", "headSha", "baseSha"] as const) {
    if (actual[key] !== expected[key]) {
      problems.push(
        reason(
          "subject-mismatch",
          `${path}.${key}`,
          `${key} does not match the evaluated subject`
        )
      );
    }
  }
  if (
    expected.kind === "pull_request" &&
    (actual.kind !== "pull_request" || actual.id !== expected.id)
  ) {
    problems.push(
      reason(
        "subject-mismatch",
        `${path}.id`,
        `evidence must identify PR ${expected.id}`
      )
    );
  }
  return problems;
};

const provenanceProblems = (
  actual: Provenance,
  expected: ProducerPolicy,
  path: string
): GateReason[] => {
  const problems: GateReason[] = [];
  if (actual.producer !== expected.producer) {
    problems.push(
      reason(
        "producer-mismatch",
        `${path}.producer`,
        "producer does not match explicit policy"
      )
    );
  }
  if (actual.runtimeFingerprint !== expected.runtimeFingerprint) {
    problems.push(
      reason(
        "runtime-mismatch",
        `${path}.runtimeFingerprint`,
        "runtime/configuration fingerprint is stale or unexpected"
      )
    );
  }
  return problems;
};

export const collectionProblems = (
  subject: Subject,
  provenance: Provenance,
  policy: EvidencePolicy,
  path: string
): GateReason[] => {
  const problems = provenanceProblems(
    provenance,
    policy.collector,
    `${path}.provenance`
  );
  if (subject.repository !== policy.repository) {
    problems.push(
      reason(
        "repository-mismatch",
        `${path}.subject.repository`,
        "repository does not match explicit policy"
      )
    );
  }
  return problems;
};

export const verificationProblems = (
  checks: CheckEvidence[],
  subject: Subject,
  name: string,
  policy: EvidencePolicy,
  path: string
): GateReason[] => {
  const matches = checks.filter((check) => check.name === name);
  const [result] = matches;
  if (matches.length !== 1 || !result) {
    return [
      reason(
        matches.length ? "duplicate-evidence" : "missing-evidence",
        path,
        `${name} requires exactly one collected result`
      ),
    ];
  }
  const location = `${path}[${checks.indexOf(result)}]`;
  const problems = [
    ...bindingProblems(result.subject, subject, `${location}.subject`),
    ...provenanceProblems(
      result.provenance,
      policy.verification,
      `${location}.provenance`
    ),
  ];
  if (result.state !== "passed") {
    problems.push(
      reason(
        "check-not-passed",
        `${location}.state`,
        `${name} is ${result.state}`
      )
    );
  }
  return problems;
};

const agentProblems = (
  pr: PullRequestEvidence,
  policy: EvidencePolicy,
  path: string
): GateReason[] => {
  const problems: GateReason[] = [];
  for (const requirement of policy.requiredAgentProviders) {
    const matches = pr.agentReviews.filter(
      (review) => review.provider === requirement.provider
    );
    const [result] = matches;
    if (matches.length !== 1 || !result) {
      problems.push(
        reason(
          matches.length ? "duplicate-evidence" : "missing-evidence",
          `${path}.agentReviews`,
          `${requirement.provider} requires exactly one review`
        )
      );
      continue;
    }
    const location = `${path}.agentReviews[${pr.agentReviews.indexOf(result)}]`;
    problems.push(
      ...bindingProblems(result.subject, pr.subject, `${location}.subject`),
      ...provenanceProblems(
        result.provenance,
        requirement,
        `${location}.provenance`
      )
    );
    if (
      result.state !== "completed" ||
      !result.complete ||
      result.verdict !== "passed"
    ) {
      problems.push(
        reason(
          "review-incomplete",
          location,
          `${requirement.provider} has not completed a passing review`
        )
      );
    }
    if (result.blockingFindings !== 0) {
      problems.push(
        reason(
          "blocking-findings",
          `${location}.blockingFindings`,
          `${requirement.provider} needs explicit zero blocking findings`
        )
      );
    }
  }
  return problems;
};

const humanProblems = (pr: PullRequestEvidence, path: string): GateReason[] => {
  const problems: GateReason[] = [];
  if (!pr.assignments.recorded) {
    problems.push(
      reason(
        "assignments-unknown",
        `${path}.assignments`,
        "persisted reviewer assignment history has not been collected"
      )
    );
  }
  const seen = new Set<string>();
  for (const [index, review] of pr.humanReviews.entries()) {
    const location = `${path}.humanReviews[${index}]`;
    if (seen.has(review.reviewer)) {
      problems.push(
        reason(
          "duplicate-evidence",
          location,
          `multiple effective reviews for ${review.reviewer}`
        )
      );
    }
    seen.add(review.reviewer);
    // An outstanding objection survives source movement and voluntary review.
    if (review.state === "changes_requested") {
      problems.push(
        reason(
          "changes-requested",
          location,
          `${review.reviewer} has an outstanding change request`
        )
      );
    }
  }
  for (const reviewer of new Set(pr.assignments.requiredReviewers)) {
    const matches = pr.humanReviews.filter(
      (review) => review.reviewer === reviewer
    );
    const [review] = matches;
    if (
      matches.length !== 1 ||
      !review ||
      review.state !== "approved" ||
      review.subject === null
    ) {
      problems.push(
        reason(
          "approval-required",
          `${path}.humanReviews`,
          `${reviewer} must approve this exact revision`
        )
      );
      continue;
    }
    problems.push(
      ...bindingProblems(
        review.subject,
        pr.subject,
        `${path}.humanReviews[${pr.humanReviews.indexOf(review)}].subject`
      )
    );
  }
  return problems;
};

const landingProblems = (
  pr: PullRequestEvidence,
  path: string
): GateReason[] => {
  const problems: GateReason[] = [];
  for (const [key, expected] of [
    ["open", true],
    ["draft", false],
    ["mergeable", true],
    ["mergeAuthorized", true],
    ["unresolvedThreads", 0],
  ] as const) {
    if (pr[key] !== expected) {
      problems.push(
        reason(
          "landing-blocked",
          `${path}.${key}`,
          `${key} must be ${expected}; observed ${pr[key]}`
        )
      );
    }
  }
  return problems;
};

export const evaluatePullRequest = (
  pr: PullRequestEvidence,
  policy: EvidencePolicy,
  path: string,
  problems: Problems,
  admission: boolean
) => {
  const common = collectionProblems(pr.subject, pr.provenance, policy, path);
  for (const name of VERIFICATION_GATES) {
    problems[admission ? "mergeability" : name].push(
      ...common,
      ...verificationProblems(
        pr.checks,
        pr.subject,
        name,
        policy,
        `${path}.checks`
      )
    );
  }
  problems["agent-review"].push(...common, ...agentProblems(pr, policy, path));
  problems["human-review"].push(...common, ...humanProblems(pr, path));
  problems.mergeability.push(...common, ...landingProblems(pr, path));
};
