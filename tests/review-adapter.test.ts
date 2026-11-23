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
  LOCAL,
  nativeResolution,
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
  reviewer: LOCAL,
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
        reviewer: LOCAL,
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
        reviewer: LOCAL,
      },
      input()
    )
  ).toThrow("unique reviewer and finding IDs");
});

test("an adapter cannot resolve another reviewer's persisted finding", () => {
  expect(() =>
    collectReviewAdapter(
      {
        collect: (given) => ({
          agentReviews: [],
          reviewFindings: {
            ...given.findings,
            findings: given.findings.findings.map((entry) => ({
              ...entry,
              resolution: nativeResolution(),
            })),
          },
          reviewLadder: null,
        }),
        reviewer: LOCAL,
      },
      input()
    )
  ).toThrow("changed another reviewer's findings");
});

test("an adapter cannot add a foreign native finding", () => {
  expect(() =>
    collectReviewAdapter(
      {
        collect: (given) => ({
          agentReviews: [],
          reviewFindings: {
            ...given.findings,
            findings: [
              ...given.findings.findings,
              finding({ id: "foreign-new", reviewer: HOSTED }),
            ],
          },
          reviewLadder: null,
        }),
        reviewer: LOCAL,
      },
      input()
    )
  ).toThrow("changed another reviewer's findings");
});

test("an adapter can update its own native finding resolution", () => {
  const stable = input();
  const collected = collectReviewAdapter(
    {
      collect: (given) => ({
        agentReviews: [],
        reviewFindings: {
          ...given.findings,
          findings: given.findings.findings.map((entry) => ({
            ...entry,
            resolution: nativeResolution(),
          })),
        },
        reviewLadder: null,
      }),
      reviewer: HOSTED,
    },
    stable
  );
  expect(collected.reviewFindings.findings[0]?.resolution).toEqual(
    nativeResolution()
  );
  expect(stable.findings.findings[0]?.resolution).toBeNull();
});

test("an adapter cannot report another reviewer's attempt", () => {
  expect(() =>
    collectReviewAdapter(
      {
        collect: (given) => ({
          agentReviews: [localAttempt({ reviewer: HOSTED })],
          reviewFindings: given.findings,
          reviewLadder: null,
        }),
        reviewer: LOCAL,
      },
      input()
    )
  ).toThrow("reported another reviewer's attempt");
});

test("inherited adapter metadata is refused instead of silently discarded", () => {
  class Result implements CollectedReviewEvidence {
    agentReviews = [];
    reviewFindings = input().findings;
    reviewLadder = null;
    get observations() {
      return { source: this.reviewFindings };
    }
  }
  expect(() =>
    collectReviewAdapter(
      { collect: () => new Result(), reviewer: LOCAL },
      input()
    )
  ).toThrow("expected a JSON object");
});

test("non-enumerable adapter metadata is refused instead of silently discarded", () => {
  expect(() =>
    collectReviewAdapter(
      {
        collect: (given) =>
          Object.defineProperty(
            {
              agentReviews: [],
              reviewFindings: given.findings,
              reviewLadder: null,
            },
            "observations",
            { value: { source: "native-review" } }
          ),
        reviewer: LOCAL,
      },
      input()
    )
  ).toThrow("expected enumerable data fields");
});
