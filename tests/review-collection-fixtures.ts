import type { AgentReviewPolicy } from "../src/evidence-types.ts";
import { object } from "../src/evidence-validation-primitives.ts";
import { reviewAdapterRegistry } from "../src/review-adapter-registry.ts";
import type {
  ReviewAdapterDefinition,
  ReviewAdapterRegistry,
  ReviewCollectionConfiguration,
  ReviewCollectionState,
} from "../src/review-collection-types.ts";
import { localAttempt, LOCAL, policyV2 } from "./agent-review-fixtures.ts";
import { config, request } from "./codex-collection-fixtures.ts";

export const fakeAdapter = (
  state: ReviewCollectionState = "passed",
  outage = false
): ReviewAdapterDefinition => ({
  configure: (entry, evidence, runId) => {
    const reviewer = (evidence.agentReview as AgentReviewPolicy).reviewers.find(
      (item) => item.reviewer === entry.reviewer
    );
    if (reviewer === undefined) {
      throw new Error("missing fixture reviewer");
    }
    return {
      adapter: entry.adapter,
      configuration: {},
      findingsComplete: true,
      issuer: {
        producer: reviewer.producer,
        runId,
        runtimeFingerprint: reviewer.runtimeFingerprint,
      },
      reviewer,
    };
  },
  normalize: (entry, _observation, input) => {
    let attemptState: "completed" | "pending" | "unavailable" = "unavailable";
    if (state === "passed" || state === "failed") {
      attemptState = "completed";
    }
    if (state === "pending") {
      attemptState = "pending";
    }
    return {
      agentReviews: [
        localAttempt({
          attemptId: `${entry.adapter}/${input.subject.headSha}/${input.subject.baseSha}`,
          complete: state === "passed" || state === "failed",
          findingIds: state === "passed" || state === "failed" ? [] : null,
          nativeRef:
            state === "passed" || state === "failed"
              ? "fixture://secondary/review/1"
              : null,
          observedAt: input.servedAt,
          provenance: entry.issuer,
          startedAt: input.snapshot?.observedAt ?? input.servedAt,
          state: attemptState,
          subject: input.subject,
          unavailableReason:
            state === "unavailable" || state === "unreadable" ? "error" : null,
          verdict: state === "passed" || state === "failed" ? state : "unknown",
        }),
      ],
      diagnostics:
        state === "unreadable" ? ["fixture-response-unreadable"] : [],
      observations: { source: "fixture://secondary/review/1" },
      reviewFindings: {
        findings: input.findings.findings,
        recorded: entry.findingsComplete,
      },
      reviewLadder: null,
      state,
    };
  },
  observe: () =>
    outage
      ? Promise.reject(new Error("PRIVATE SOURCE ERROR"))
      : Promise.resolve({ source: "stable" }),
  parsePolicy: (value) => object(value, "fixture.configuration", []),
  validate: (entry) => {
    object(entry.configuration, "fixture.configuration", []);
  },
});

export const registry = (
  state: ReviewCollectionState = "passed",
  outage = false
): ReviewAdapterRegistry => ({
  ...reviewAdapterRegistry,
  secondary: fakeAdapter(state, outage),
});

export const secondary = (): ReviewCollectionConfiguration => {
  const reviewer = policyV2().agentReview.reviewers.find(
    (entry) => entry.reviewer === LOCAL
  );
  if (reviewer === undefined) {
    throw new Error("missing fixture reviewer");
  }
  return {
    adapter: "secondary",
    configuration: {},
    findingsComplete: true,
    issuer: {
      producer: reviewer.producer,
      runId: "secondary-run",
      runtimeFingerprint: reviewer.runtimeFingerprint,
    },
    reviewer,
  };
};

export const configuredRequest = () => {
  const { codexReview: _legacy, ...base } = request();
  const {
    attestation,
    botAccountId,
    findingsComplete,
    issuer,
    maxCommentPages,
    reviewer,
  } = config();
  return {
    ...base,
    reviewAdapters: [
      {
        adapter: "codex-github",
        configuration: { attestation, botAccountId, maxCommentPages },
        findingsComplete: findingsComplete === true,
        issuer,
        reviewer,
      },
      secondary(),
    ],
  };
};
