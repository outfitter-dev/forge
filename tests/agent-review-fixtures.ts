import type {
  AgentReviewAttempt,
  EvidencePolicyV2,
  FindingResolution,
  MergeGroupFactsV2,
  PullRequestEvidenceV2,
  PullRequestFactsV2,
  ReviewFinding,
  ReviewLadder,
} from "../src/index.ts";
import {
  BASE,
  HEAD,
  passingGroup,
  passingPr,
  policy,
  provenance,
  subject,
} from "./evidence-fixtures.ts";

export const HOSTED = "hosted-bot";
export const LOCAL = "local-cli";
export const STANDARD = {
  digest: "4".repeat(64),
  id: "general-review/standard@1",
};
export const FRESH_EYES = {
  digest: "5".repeat(64),
  id: "general-review/fresh-eyes@1",
};

const HOSTED_ISSUER = {
  producer: "hosted-collector:fixture",
  runtimeFingerprint: "6".repeat(64),
};
const LOCAL_ISSUER = {
  producer: "agent:fixture",
  runtimeFingerprint: "3".repeat(64),
};
const LADDER_ISSUER = {
  producer: "ladder:fixture",
  runtimeFingerprint: "7".repeat(64),
};

export const hostedProvenance = () => ({
  ...HOSTED_ISSUER,
  runId: "offline-run-1",
});

export const policyV2 = (): EvidencePolicyV2 => {
  const { collector, repository, verification } = policy();
  return {
    agentReview: {
      instructions: [STANDARD, FRESH_EYES],
      ladder: LADDER_ISSUER,
      reviewers: [
        {
          ...HOSTED_ISSUER,
          reviewer: HOSTED,
          rung: "hosted",
          waitSeconds: 900,
        },
        { ...LOCAL_ISSUER, reviewer: LOCAL, rung: "local" },
      ],
    },
    collector,
    repository,
    schemaVersion: 2,
    verification,
  };
};

/** A clean, complete, clean-context local review of the fixture revision. */
export const localAttempt = (
  overrides: Partial<AgentReviewAttempt> = {}
): AgentReviewAttempt => ({
  attemptId: "ladder-1/2",
  complete: true,
  context: "none",
  deadlineAt: null,
  findingIds: [],
  harness: "fixture-harness",
  instructions: STANDARD,
  kind: "general-review",
  launch: "separate-invocation",
  model: "fixture-model-a",
  nativeRef: "fixture://runs/ladder-1/attempts/2",
  observedAt: "2026-01-01T00:20:00Z",
  provenance: provenance("agent"),
  reviewer: LOCAL,
  rung: "local",
  startedAt: "2026-01-01T00:15:00Z",
  state: "completed",
  subject: subject(),
  unavailableReason: null,
  verdict: "passed",
  ...overrides,
});

/** A hosted reviewer that had not reported when its configured wait ended. */
export const hostedAttempt = (
  overrides: Partial<AgentReviewAttempt> = {}
): AgentReviewAttempt => ({
  attemptId: "ladder-1/1",
  complete: false,
  context: "unknown",
  deadlineAt: "2026-01-01T00:15:00Z",
  findingIds: null,
  harness: null,
  instructions: null,
  kind: "general-review",
  launch: "unknown",
  model: null,
  nativeRef: null,
  observedAt: "2026-01-01T00:15:00Z",
  provenance: hostedProvenance(),
  reviewer: HOSTED,
  rung: "hosted",
  startedAt: "2026-01-01T00:00:00Z",
  state: "unavailable",
  subject: subject(),
  unavailableReason: "timeout",
  verdict: "unknown",
  ...overrides,
});

/** A hosted review that reported; its collector attests an independent run. */
export const hostedReport = (
  overrides: Partial<AgentReviewAttempt> = {}
): AgentReviewAttempt =>
  hostedAttempt({
    complete: true,
    context: "none",
    findingIds: [],
    nativeRef: "fixture://hosted/reviews/1",
    observedAt: "2026-01-01T00:05:00Z",
    state: "completed",
    unavailableReason: null,
    verdict: "passed",
    ...overrides,
  });

/** An unresolved finding first reported by an earlier local attempt. */
export const finding = (
  overrides: Partial<ReviewFinding> = {}
): ReviewFinding => ({
  attemptId: "ladder-0/1",
  id: "F1",
  kind: "finding",
  nativeRef: "fixture://runs/ladder-0/attempts/1#F1",
  resolution: null,
  reviewer: LOCAL,
  ...overrides,
});

export const followUp = (
  overrides: Partial<
    Extract<FindingResolution, { kind: "follow-up-review" }>
  > = {}
): FindingResolution => ({
  attemptId: "ladder-1/2",
  disposition: "fixed",
  kind: "follow-up-review",
  nativeRef: "fixture://runs/ladder-1/attempts/2#F1",
  provenance: provenance("agent"),
  subject: subject(),
  ...overrides,
});

export const nativeResolution = (
  overrides: Partial<Extract<FindingResolution, { kind: "native" }>> = {}
): FindingResolution => ({
  kind: "native",
  nativeRef: "fixture://hosted/threads/T1#resolved",
  provenance: hostedProvenance(),
  ...overrides,
});

export const exhausted = (
  overrides: Partial<ReviewLadder> = {}
): ReviewLadder => ({
  exhausted: true,
  provenance: { ...LADDER_ISSUER, runId: "ladder-1" },
  subject: subject(),
  ...overrides,
});

export const passingPrV2 = (
  id = 1,
  headSha = HEAD,
  baseSha = BASE
): PullRequestEvidenceV2 => ({
  ...passingPr(id, headSha, baseSha),
  agentReviews: [
    hostedAttempt({ subject: subject(id, headSha, baseSha) }),
    localAttempt({ subject: subject(id, headSha, baseSha) }),
  ],
  reviewFindings: { findings: [], recorded: true },
  reviewLadder: null,
});

export const passingFactsV2 = (): PullRequestFactsV2 => ({
  event: "pull_request",
  pullRequest: passingPrV2(),
  schemaVersion: 2,
});

export const passingGroupV2 = (): MergeGroupFactsV2 => ({
  ...passingGroup(),
  admissions: [passingPrV2()],
  schemaVersion: 2,
});
