import {
  bindingProblems,
  provenanceProblems,
  reason,
} from "./evidence-gates.ts";
import type {
  AgentReviewAttempt,
  AgentReviewPolicy,
  GateReason,
  PullRequestEvidenceV2,
  ReviewFinding,
} from "./evidence-types.ts";

export interface Review {
  pr: PullRequestEvidenceV2;
  policy: AgentReviewPolicy;
  /** Attempts that are credible reviews of exactly this revision. */
  credible: Set<AgentReviewAttempt>;
}

/** The same native ID under another reviewer is a different entry. */
export const identity = (reviewer: string, id: string) =>
  JSON.stringify([reviewer, id]);

export const configured = (policy: AgentReviewPolicy, reviewer: string) =>
  policy.reviewers.find((item) => item.reviewer === reviewer);

/** Absence, a push, a timeout, or another reviewer's clean result resolves nothing. */
const resolved = (finding: ReviewFinding, review: Review): boolean => {
  const { resolution } = finding;
  if (resolution === null) {
    return false;
  }
  const { credible, policy, pr } = review;
  if (resolution.kind === "native") {
    const reviewer = configured(policy, finding.reviewer);
    return (
      reviewer?.rung === "hosted" &&
      provenanceProblems(resolution.provenance, reviewer, "").length === 0
    );
  }
  const followUps = pr.agentReviews.filter(
    (attempt) => attempt.attemptId === resolution.attemptId
  );
  const [followUp] = followUps;
  if (followUps.length !== 1 || !followUp || !credible.has(followUp)) {
    return false;
  }
  const issuer = configured(policy, followUp.reviewer);
  return (
    issuer !== undefined &&
    // The reporting attempt cannot resolve its own entry, whatever it lists.
    followUp.attemptId !== finding.attemptId &&
    followUp.verdict !== "unknown" &&
    followUp.findingIds !== null &&
    !(
      followUp.reviewer === finding.reviewer &&
      followUp.findingIds.includes(finding.id)
    ) &&
    bindingProblems(resolution.subject, pr.subject, "").length === 0 &&
    provenanceProblems(resolution.provenance, issuer, "").length === 0
  );
};

/**
 * Every ledger entry blocks until it has an accepted resolution, whatever
 * revision raised it and whether or not its attempt is still presented.
 */
export const evaluateLedger = (review: Review, path: string) => {
  const ledger = review.pr.reviewFindings;
  const blockers: GateReason[] = [];
  const recorded = new Set<string>();
  const unresolved = new Set<string>();
  if (!ledger.recorded) {
    blockers.push(
      reason(
        "findings-unknown",
        path,
        "the persisted review finding ledger has not been collected"
      )
    );
  }
  for (const [index, finding] of ledger.findings.entries()) {
    const location = `${path}.findings[${index}]`;
    const key = identity(finding.reviewer, finding.id);
    const label = `${finding.reviewer} ${finding.kind} ${finding.id}`;
    if (recorded.has(key)) {
      blockers.push(
        reason(
          "duplicate-evidence",
          location,
          `multiple ledger entries for ${label}`
        )
      );
    }
    recorded.add(key);
    if (!resolved(finding, review)) {
      unresolved.add(key);
      blockers.push(
        reason(
          "blocking-findings",
          location,
          finding.resolution === null
            ? `${label} is unresolved`
            : `${label} has no accepted resolution`
        )
      );
    }
  }
  return { blockers, recorded, unresolved };
};
