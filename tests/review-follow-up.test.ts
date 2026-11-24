import { expect, test } from "bun:test";

import { collectedReviewAdapters } from "../src/collect-review-adapters.ts";
import type {
  ReviewFinding,
  ReviewFindingLedger,
} from "../src/evidence-types.ts";
import type {
  ReviewObservationInput,
  ReviewSourceObservation,
} from "../src/review-collection-types.ts";
import { applyCollectedReviewFollowUps } from "../src/review-follow-up.ts";
import { subject } from "./evidence-fixtures.ts";
import { fakeAdapter, secondary } from "./review-collection-fixtures.ts";

test.each([
  "linked",
  "same-origin",
  "foreign-reviewer",
  "wrong-issuer",
  "duplicate-attempt",
  "unstable-source",
  "failed-source",
  "unavailable-result",
  "native-finding",
] as const)("explicit follow-up keeps bounded authority (%s)", (mode) => {
  const finding: ReviewFinding = {
    attemptId: "reporter/original-attempt",
    id: "adverse-review:source:version:digest",
    kind: mode === "native-finding" ? "finding" : "adverse-review",
    nativeRef: "fixture://reporter/adverse-summary",
    reportingSource: { accountId: 123, actorType: "Bot" },
    resolution: null,
    reviewer: "reporting-only-bot",
  };
  const findings: ReviewFindingLedger = { findings: [finding], recorded: true };
  const input: ReviewObservationInput = {
    findings,
    reviewThreads: [],
    servedAt: "2026-01-01T01:00:00Z",
    snapshot: null,
    subject: subject(),
  };
  const entry = secondary();
  const adapter = fakeAdapter();
  const { normalize } = adapter;
  adapter.normalize = (configuration, observation, stable) => {
    const result = normalize(configuration, observation, stable);
    const [attempt] = result.agentReviews;
    if (attempt === undefined) {
      throw new Error("missing fixture attempt");
    }
    if (mode === "same-origin") {
      attempt.attemptId = finding.attemptId;
    }
    if (mode === "foreign-reviewer") {
      attempt.reviewer = "some-other-reviewer";
    }
    if (mode === "wrong-issuer") {
      attempt.provenance.runtimeFingerprint = "f".repeat(64);
    }
    if (mode === "duplicate-attempt") {
      result.agentReviews.push(structuredClone(attempt));
    }
    if (mode === "unavailable-result") {
      result.state = "unavailable";
    }
    result.followUpResolutions = [
      {
        attemptId: attempt.attemptId,
        disposition: "fixed",
        finding: {
          attemptId: finding.attemptId,
          id: finding.id,
          nativeRef: finding.nativeRef,
          reviewer: finding.reviewer,
        },
        nativeRef: "fixture://follow-up/explicit-target",
      },
    ];
    return result;
  };
  const first: ReviewSourceObservation[] = [
    { status: "observed", value: { version: 1 } },
  ];
  let second: ReviewSourceObservation[] = structuredClone(first);
  if (mode === "unstable-source") {
    second = [{ status: "observed", value: { version: 2 } }];
  }
  if (mode === "failed-source") {
    second = [
      { read: null, reason: "source-unavailable", status: "unavailable" },
    ];
  }
  const collection = collectedReviewAdapters([entry], first, second, input, {
    secondary: adapter,
  });
  const result = applyCollectedReviewFollowUps(collection, {
    ...input,
    findings: collection.reviewFindings,
  });
  expect(result.findings[0]?.resolution?.kind ?? null).toBe(
    mode === "linked" ? "follow-up-review" : null
  );
  expect<unknown>({ ...result.findings[0], resolution: null }).toEqual(finding);
});
