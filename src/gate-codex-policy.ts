import type { PullRequestCodexReviewConfig } from "./collect-pull-request-types.ts";
import type { AgentReviewPolicy, ReviewerPolicy } from "./evidence-types.ts";
import {
  count,
  invalid,
  object,
  text,
} from "./evidence-validation-primitives.ts";
import type { GatePolicy } from "./gate-policy.ts";
import { agentReviewPolicy } from "./validate-agent-review.ts";

const INDEPENDENCE =
  "separate-hosted-invocation-without-inherited-author-context";

export interface GateCodexReviewPolicy {
  reviewer: string;
  botAccountId: number;
  independence: null | {
    id: string;
    policyRevision: string;
    statement: typeof INDEPENDENCE;
  };
}

const eligibleReviewer = (
  name: string,
  evidence: GatePolicy["evidence"]
): Extract<ReviewerPolicy, { rung: "hosted" }> => {
  const policy = evidence.agentReview as AgentReviewPolicy;
  const reviewer = policy.reviewers.find((entry) => entry.reviewer === name);
  if (reviewer?.rung !== "hosted") {
    return invalid(
      "gatePolicy.codexReview.reviewer",
      "expected exactly one eligible hosted reviewer"
    );
  }
  return reviewer;
};

/** A distinct explicit collector-policy statement, scoped to the wrapper's repository and reviewer. */
export const parseGateCodexReviewPolicy = (
  value: unknown,
  evidence: GatePolicy["evidence"]
): GateCodexReviewPolicy => {
  agentReviewPolicy(evidence.agentReview, "gatePolicy.evidence.agentReview");
  const path = "gatePolicy.codexReview";
  const source = object(value, path, [
    "reviewer",
    "botAccountId",
    "independence",
  ]);
  const reviewer = text(source.reviewer, `${path}.reviewer`);
  eligibleReviewer(reviewer, evidence);
  count(source.botAccountId, `${path}.botAccountId`);
  if (source.botAccountId === 0) {
    invalid(`${path}.botAccountId`, "expected a positive account ID");
  }
  let independence: GateCodexReviewPolicy["independence"] = null;
  if (source.independence !== null) {
    const claim = object(source.independence, `${path}.independence`, [
      "id",
      "policyRevision",
      "statement",
    ]);
    if (claim.statement !== INDEPENDENCE) {
      invalid(
        `${path}.independence.statement`,
        "expected the explicit hosted independence statement"
      );
    }
    independence = {
      id: text(claim.id, `${path}.independence.id`),
      policyRevision: text(
        claim.policyRevision,
        `${path}.independence.policyRevision`
      ),
      statement: INDEPENDENCE,
    };
  }
  return {
    botAccountId: source.botAccountId as number,
    independence,
    reviewer,
  };
};

export const gateCodexCollection = (
  policy: GatePolicy,
  runId: string,
  maxCommentPages: number
): PullRequestCodexReviewConfig | undefined => {
  const configured = policy.codexReview;
  if (configured === undefined) {
    return undefined;
  }
  const reviewer = eligibleReviewer(configured.reviewer, policy.evidence);
  return {
    attestation:
      configured.independence === null
        ? null
        : {
            botAccountId: configured.botAccountId,
            id: configured.independence.id,
            policyRevision: configured.independence.policyRevision,
            repository: policy.evidence.repository,
            reviewer: configured.reviewer,
          },
    botAccountId: configured.botAccountId,
    issuer: {
      producer: reviewer.producer,
      runId,
      runtimeFingerprint: reviewer.runtimeFingerprint,
    },
    maxCommentPages,
    reviewer,
  };
};
