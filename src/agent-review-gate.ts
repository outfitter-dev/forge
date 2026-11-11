import {
  bindingProblems,
  provenanceProblems,
  reason,
} from "./evidence-gates.ts";
import type {
  AgentReviewAttempt,
  AgentReviewOutcome,
  AgentReviewPolicy,
  GateReason,
  PullRequestEvidenceV2,
} from "./evidence-types.ts";
import {
  configured,
  evaluateLedger,
  identity,
} from "./review-finding-ledger.ts";

const SECOND = 1000;

/**
 * Why an attempt is not a credible review of this exact revision. Every
 * comparison is a claim checked against policy; none authenticates the issuer.
 */
const credibilityProblems = (
  attempt: AgentReviewAttempt,
  pr: PullRequestEvidenceV2,
  policy: AgentReviewPolicy,
  location: string
): GateReason[] => {
  const reviewer = configured(policy, attempt.reviewer);
  if (!reviewer || reviewer.rung !== attempt.rung) {
    return [
      reason(
        "reviewer-not-acceptable",
        `${location}.reviewer`,
        `${attempt.reviewer} is not a configured ${attempt.rung} reviewer`
      ),
    ];
  }
  const problems = [
    ...bindingProblems(attempt.subject, pr.subject, `${location}.subject`),
    ...provenanceProblems(
      attempt.provenance,
      reviewer,
      `${location}.provenance`
    ),
  ];
  if (
    reviewer.rung === "hosted" &&
    (attempt.deadlineAt === null ||
      Date.parse(attempt.deadlineAt) - Date.parse(attempt.startedAt) !==
        reviewer.waitSeconds * SECOND)
  ) {
    problems.push(
      reason(
        "deadline-mismatch",
        `${location}.deadlineAt`,
        `${attempt.reviewer} deadline is not startedAt plus the configured wait`
      )
    );
  }
  if (attempt.state === "unavailable") {
    problems.push(
      reason(
        "review-unavailable",
        `${location}.state`,
        `${attempt.reviewer} was unavailable: ${attempt.unavailableReason}`
      )
    );
    return problems;
  }
  if (attempt.state === "pending") {
    problems.push(
      reason(
        "review-pending",
        `${location}.state`,
        `${attempt.reviewer} has not reported`
      )
    );
    return problems;
  }
  if (
    attempt.state !== "completed" ||
    !attempt.complete ||
    attempt.nativeRef === null
  ) {
    problems.push(
      reason(
        "review-incomplete",
        location,
        `${attempt.reviewer} has no completed, explicitly complete review with a durable receipt`
      )
    );
  }
  if (attempt.context !== "none") {
    problems.push(
      reason(
        "review-not-independent",
        `${location}.context`,
        `${attempt.reviewer} is not attested to have run in a clean context`
      )
    );
  }
  if (
    reviewer.rung === "local" &&
    !policy.instructions.some(
      (item) =>
        item.id === attempt.instructions?.id &&
        item.digest === attempt.instructions.digest
    )
  ) {
    problems.push(
      reason(
        "instructions-untrusted",
        `${location}.instructions`,
        `${attempt.reviewer} did not use trusted fixed instructions`
      )
    );
  }
  return problems;
};

/** A claim is diagnostic; it routes a failure and never changes pass or fail. */
const exhaustionProblems = (
  pr: PullRequestEvidenceV2,
  policy: AgentReviewPolicy,
  path: string
): GateReason[] | null => {
  const ladder = pr.reviewLadder;
  if (!ladder?.exhausted) {
    return null;
  }
  return [
    ...bindingProblems(ladder.subject, pr.subject, `${path}.subject`),
    ...provenanceProblems(
      ladder.provenance,
      policy.ladder,
      `${path}.provenance`
    ),
  ];
};

/** Whether one attempt is the clean review the gate needs, and why not. */
const cleanProblems = (
  attempt: AgentReviewAttempt,
  shortfalls: GateReason[],
  open: boolean,
  location: string
): GateReason[] => {
  const problems = [...shortfalls];
  if (
    shortfalls.length === 0 &&
    (attempt.verdict !== "passed" || attempt.findingIds === null)
  ) {
    problems.push(
      reason(
        "review-incomplete",
        `${location}.verdict`,
        `${attempt.reviewer} has no passing verdict with known findings`
      )
    );
  }
  if (open) {
    problems.push(
      reason(
        "blocking-findings",
        `${location}.findingIds`,
        `${attempt.reviewer} reported findings that are not resolved`
      )
    );
  }
  return problems;
};

/**
 * Schema version 2: one credible clean review from any eligible reviewer, and
 * no ledger entry left unresolved. Configured reviewers are choices, not
 * requirements, and an attempt that never satisfies also never vetoes.
 */
export const evaluateAgentReview = (
  pr: PullRequestEvidenceV2,
  policy: AgentReviewPolicy,
  path: string,
  collectionBlocked: boolean
): { outcome: AgentReviewOutcome; reasons: GateReason[] } => {
  const attempts = pr.agentReviews;
  const locate = (index: number) => `${path}.agentReviews[${index}]`;
  const shortfalls = attempts.map((attempt, index) =>
    credibilityProblems(attempt, pr, policy, locate(index))
  );
  const credible = new Set(
    attempts.filter((_, index) => shortfalls[index]?.length === 0)
  );
  const { blockers, recorded, unresolved } = evaluateLedger(
    { credible, policy, pr },
    `${path}.reviewFindings`
  );
  if (
    new Set(attempts.map((item) => item.attemptId)).size !== attempts.length
  ) {
    blockers.push(
      reason(
        "duplicate-evidence",
        `${path}.agentReviews`,
        "attempt IDs must be unique"
      )
    );
  }
  const satisfiedBy: string[] = [];
  const diagnostics: GateReason[] = [];
  for (const [index, attempt] of attempts.entries()) {
    const reported = (attempt.findingIds ?? []).map((id) =>
      identity(attempt.reviewer, id)
    );
    for (const [position, key] of reported.entries()) {
      if (!recorded.has(key)) {
        blockers.push(
          reason(
            "missing-evidence",
            `${locate(index)}.findingIds[${position}]`,
            "a reported finding is absent from the ledger"
          )
        );
      }
    }
    const problems = cleanProblems(
      attempt,
      shortfalls[index] ?? [],
      reported.some((key) => unresolved.has(key) || !recorded.has(key)),
      locate(index)
    );
    if (problems.length === 0) {
      satisfiedBy.push(attempt.attemptId);
    }
    diagnostics.push(...problems);
  }
  const outcome = (disposition: AgentReviewOutcome["disposition"]) => ({
    disposition,
    pullRequest: pr.subject.id,
    satisfiedBy,
  });
  if (satisfiedBy.length > 0) {
    const passed = blockers.length === 0 && !collectionBlocked;
    return {
      outcome: outcome(passed ? "satisfied" : "blocked"),
      reasons: blockers,
    };
  }
  const reasons = [
    ...blockers,
    reason(
      "missing-evidence",
      `${path}.agentReviews`,
      "no eligible reviewer has a completed, explicitly complete, clean review of this revision"
    ),
    ...diagnostics,
  ];
  const doubts = exhaustionProblems(pr, policy, `${path}.reviewLadder`);
  // Only unresolved findings may stand beside an accepted claim: a missing,
  // ambiguous, or incomplete ledger is collection to retry, not exhaustion.
  const unsettled =
    blockers.some((item) => item.code !== "blocking-findings") ||
    diagnostics.some(
      (item) =>
        item.code === "review-pending" || item.code === "deadline-mismatch"
    );
  if (doubts?.length !== 0 || unsettled || collectionBlocked) {
    return {
      outcome: outcome("blocked"),
      reasons: [...reasons, ...(doubts ?? [])],
    };
  }
  return {
    outcome: outcome("needs_human"),
    reasons: [
      ...reasons,
      reason(
        "ladder-exhausted",
        `${path}.reviewLadder`,
        "the review ladder is exhausted and needs a decision from outside it; a human-review approval does not satisfy this gate"
      ),
    ],
  };
};
