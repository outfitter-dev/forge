import { expect, test } from "bun:test";

import { gateReviewEvidence } from "../src/gate-review-evidence.ts";
import { evaluateEvidence } from "../src/index.ts";
import { collectReviewAdapter } from "../src/review-adapter.ts";
import type {
  CollectedReviewEvidence,
  ReviewAdapter,
  ReviewAdapterInput,
} from "../src/review-adapter.ts";
import {
  finding,
  HOSTED,
  localAttempt,
  passingFactsV2,
  policyV2,
} from "./agent-review-fixtures.ts";
import { subject } from "./evidence-fixtures.ts";

const input = (): ReviewAdapterInput => ({
  findings: { findings: [finding({ reviewer: HOSTED })], recorded: true },
  servedAt: "2026-01-01T00:20:00Z",
  subject: subject(),
});

const secondAdapter: ReviewAdapter<CollectedReviewEvidence> = {
  collect: (stable) => ({
    agentReviews: [localAttempt()],
    reviewFindings: stable.findings,
    reviewLadder: null,
  }),
};

test("a clean second adapter keeps an earlier unresolved finding blocking through the gate", () => {
  const stable = input();
  const collected = collectReviewAdapter(secondAdapter, stable);
  const facts = passingFactsV2();
  Object.assign(
    facts.pullRequest,
    gateReviewEvidence(collected.reviewFindings, collected, null)
  );
  const result = evaluateEvidence(facts, policyV2());
  expect(result.status).toBe("evaluated");
  if (result.status === "evaluated") {
    expect(result.eligible).toBe(false);
    expect(
      result.gates.find((gate) => gate.name === "agent-review")?.reasons
    ).toContainEqual(expect.objectContaining({ code: "blocking-findings" }));
  }
  expect(collected.reviewFindings).toEqual(stable.findings);
});

test("an adapter cannot remove earlier findings by mutating its input", () => {
  const stable = input();
  expect(() =>
    collectReviewAdapter(
      {
        collect: (given) => {
          given.findings.findings = [];
          return {
            agentReviews: [],
            reviewFindings: given.findings,
            reviewLadder: null,
          };
        },
      },
      stable
    )
  ).toThrow("discarded an accepted finding");
  expect(stable.findings.findings).toEqual([finding({ reviewer: HOSTED })]);
});

test("the adapter boundary rejects duplicate finding identities", () => {
  expect(() =>
    collectReviewAdapter(
      {
        collect: (given) => ({
          agentReviews: [],
          reviewFindings: {
            ...given.findings,
            findings: [finding(), finding()],
          },
          reviewLadder: null,
        }),
      },
      input()
    )
  ).toThrow("unique reviewer and finding IDs");
});
