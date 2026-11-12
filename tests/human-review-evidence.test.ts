import { expect, test } from "bun:test";

import {
  HumanReviewError,
  humanReviewEvidence,
} from "../src/human-review-evidence.ts";
import type {
  HumanReviewInput,
  ReviewLedgerEntry,
} from "../src/human-review-evidence.ts";
import { evaluateEvidence } from "../src/index.ts";
import type { HumanReviewEvidence } from "../src/index.ts";
import {
  parsePullRequest,
  parseReviewRequests,
  parseReviews,
} from "../src/parse-github-pull-request.ts";
import {
  at,
  passingFacts,
  passingPr,
  policy,
  REPOSITORY,
} from "./evidence-fixtures.ts";
import {
  actorResponse,
  BASE,
  HEAD,
  pullRequestResponse,
  reviewRequestedEvent,
  reviewResponse,
  teamResponse,
} from "./github-fixtures.ts";

const OTHER = "c".repeat(40);
const BEFORE = "2026-01-01T00:00:00Z";
const AFTER = "2026-01-01T00:10:00Z";
const LATER = "2026-01-01T00:20:00Z";

const pullRequest = (overrides: Record<string, unknown> = {}) =>
  parsePullRequest(
    pullRequestResponse({
      requested_reviewers: [],
      requested_teams: [],
      ...overrides,
    })
  );

const reviews = (...overrides: Record<string, unknown>[]) =>
  parseReviews(overrides.map((item) => reviewResponse(item)));

const ledger = (
  overrides: Partial<ReviewLedgerEntry> = {}
): ReviewLedgerEntry => ({
  observedRevision: null,
  requiredReviewers: [],
  reviewBindings: {},
  ...overrides,
});

const observed = (observedAt = BEFORE, headSha = HEAD, baseSha = BASE) => ({
  baseSha,
  headSha,
  observedAt,
});

const evidence = (input: Partial<HumanReviewInput> = {}) =>
  humanReviewEvidence({
    ledger: ledger(),
    pullRequest: pullRequest(),
    repository: REPOSITORY,
    requests: [],
    reviews: [],
    ...input,
  });

const approvedAt = (baseSha: string): HumanReviewEvidence => ({
  reviewer: "reviewer",
  state: "approved",
  subject: {
    baseSha,
    headSha: HEAD,
    id: 12,
    kind: "pull_request",
    repository: REPOSITORY,
  },
});

test("a request that left the pull request is still required", () => {
  const result = evidence({
    requests: parseReviewRequests([reviewRequestedEvent()]),
  });
  expect(result.assignments).toEqual({
    recorded: true,
    requiredReviewers: ["reviewer"],
  });
  expect(result.ledger.requiredReviewers).toEqual(["reviewer"]);
});

test("the ledger keeps a requirement that GitHub no longer shows", () => {
  const result = evidence({
    ledger: ledger({ requiredReviewers: ["earlier"] }),
    pullRequest: pullRequest({ requested_reviewers: [actorResponse()] }),
  });
  expect(result.assignments.requiredReviewers).toEqual(["earlier", "reviewer"]);
});

test("a team request stays an unsatisfied requirement of its own", () => {
  const result = evidence({
    pullRequest: pullRequest({ requested_teams: [teamResponse()] }),
    requests: parseReviewRequests([
      reviewRequestedEvent({
        requested_reviewer: undefined,
        requested_team: teamResponse("security", 32),
      }),
    ]),
    reviews: reviews({}),
  });
  expect(result.assignments.requiredReviewers).toEqual([
    "team:maintainers",
    "team:security",
  ]);
  expect(result.humanReviews.map((review) => review.reviewer)).toEqual([
    "reviewer",
  ]);
});

test("a requested bot is not a required human reviewer", () => {
  const result = evidence({
    pullRequest: pullRequest({
      requested_reviewers: [actorResponse("review-bot", 50, "Bot")],
    }),
  });
  expect(result.assignments.requiredReviewers).toEqual([]);
});

test("reviews by the author or by a bot are not human review evidence", () => {
  const result = evidence({
    reviews: reviews(
      { id: 1, user: actorResponse("author", 3) },
      { id: 2, user: actorResponse("review-bot", 50, "Bot") }
    ),
  });
  expect(result.humanReviews).toEqual([]);
});

test("a later comment does not discard an approval", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    reviews: reviews(
      { id: 1, submitted_at: AFTER },
      { id: 2, state: "COMMENTED", submitted_at: LATER }
    ),
  });
  expect(result.humanReviews).toEqual([approvedAt(BASE)]);
});

test("a later comment does not clear a change request", () => {
  const result = evidence({
    reviews: reviews(
      { id: 1, state: "CHANGES_REQUESTED", submitted_at: AFTER },
      { id: 2, state: "COMMENTED", submitted_at: LATER }
    ),
  });
  expect(result.humanReviews).toEqual([
    { reviewer: "reviewer", state: "changes_requested", subject: null },
  ]);
});

test("a dismissed approval no longer approves", () => {
  const result = evidence({
    reviews: reviews({ state: "DISMISSED", submitted_at: AFTER }),
  });
  expect(result.humanReviews).toEqual([
    { reviewer: "reviewer", state: "dismissed", subject: null },
  ]);
});

test("the decision submitted last wins, whatever the review IDs say", () => {
  const objection = evidence({
    reviews: reviews(
      { id: 9, submitted_at: AFTER },
      { id: 1, state: "CHANGES_REQUESTED", submitted_at: LATER }
    ),
  });
  expect(at(objection.humanReviews).state).toBe("changes_requested");
  const approval = evidence({
    reviews: reviews(
      { id: 9, state: "CHANGES_REQUESTED", submitted_at: AFTER },
      { id: 1, submitted_at: LATER }
    ),
  });
  expect(at(approval.humanReviews).state).toBe("approved");
});

const TIED = [
  { id: 9, submitted_at: AFTER },
  { id: 1, state: "DISMISSED", submitted_at: AFTER },
  { id: 2, state: "CHANGES_REQUESTED", submitted_at: AFTER },
];

test.each([
  { order: [0, 1, 2] },
  { order: [2, 1, 0] },
  { order: [2, 0, 1] },
  { order: [1, 2, 0] },
])(
  "decisions submitted together resolve to the change request in any order $order",
  ({ order }) => {
    const result = evidence({
      reviews: reviews(...order.map((index) => at(TIED, index))),
    });
    expect(at(result.humanReviews).state).toBe("changes_requested");
  }
);

test("a dismissal submitted with an approval wins in either order", () => {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    const result = evidence({
      reviews: reviews(...order.map((index) => at(TIED, index))),
    });
    expect(at(result.humanReviews).state).toBe("dismissed");
  }
});

test("approvals of different commits at the same time stop collection", () => {
  expect(() =>
    evidence({
      reviews: reviews(
        { id: 1, submitted_at: AFTER },
        { commit_id: OTHER, id: 2, submitted_at: AFTER }
      ),
    })
  ).toThrow(HumanReviewError);
});

test.each([
  { submitted_at: undefined },
  { submitted_at: "yesterday" },
  { submitted_at: "2026-01-01T00:10:00" },
  { submitted_at: "2026-01-01 00:10:00Z" },
  { submitted_at: "2026-13-01T00:10:00Z" },
])("a decision without a readable UTC time stops collection %p", (broken) => {
  expect(() =>
    evidence({
      reviews: reviews({ id: 1, submitted_at: AFTER }, { id: 2, ...broken }),
    })
  ).toThrow(HumanReviewError);
});

test("an approval first seen with no earlier snapshot stays unbound", () => {
  const result = evidence({ reviews: reviews({ submitted_at: AFTER }) });
  expect(result.humanReviews).toEqual([
    { reviewer: "reviewer", state: "approved", subject: null },
  ]);
  expect(result.ledger.reviewBindings).toEqual({});
});

test("an approval after a snapshot of this revision takes that base", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(result.humanReviews).toEqual([approvedAt(BASE)]);
  expect(result.ledger.reviewBindings).toEqual({
    "900": {
      baseSha: BASE,
      headSha: HEAD,
      observedAt: BEFORE,
      submittedAt: AFTER,
    },
  });
});

test.each([
  { name: "after the approval", snapshot: observed(LATER) },
  { name: "at the same instant", snapshot: observed(AFTER) },
  { name: "of another head", snapshot: observed(BEFORE, OTHER) },
  { name: "of another base", snapshot: observed(BEFORE, HEAD, OTHER) },
  { name: "with an unreadable time", snapshot: observed("recently") },
])("a snapshot $name cannot bind the approval", ({ snapshot }) => {
  const result = evidence({
    ledger: ledger({ observedRevision: snapshot }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(at(result.humanReviews).subject).toBeNull();
  expect(result.ledger.reviewBindings).toEqual({});
});

test("an approval of an older commit cannot bind to the current revision", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    reviews: reviews({ commit_id: OTHER, submitted_at: AFTER }),
  });
  expect(at(result.humanReviews).subject).toBeNull();
});

test("a recorded binding keeps its base when the base moves", () => {
  const binding = {
    baseSha: BASE,
    headSha: HEAD,
    observedAt: BEFORE,
    submittedAt: AFTER,
  };
  const result = evidence({
    ledger: ledger({
      observedRevision: observed(BEFORE, HEAD, OTHER),
      reviewBindings: { "900": binding },
    }),
    pullRequest: pullRequest({
      base: { ref: "main", repo: { id: 100 }, sha: OTHER },
    }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(result.humanReviews).toEqual([approvedAt(BASE)]);
  expect(result.ledger.reviewBindings).toEqual({ "900": binding });
});

test("a recorded binding that no longer matches its review binds nothing", () => {
  const result = evidence({
    ledger: ledger({
      observedRevision: observed(),
      reviewBindings: {
        "900": {
          baseSha: BASE,
          headSha: OTHER,
          observedAt: BEFORE,
          submittedAt: AFTER,
        },
      },
    }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(at(result.humanReviews).subject).toBeNull();
});

test("the ledger passed in is left as it was", () => {
  const before = ledger({ observedRevision: observed() });
  const snapshot = structuredClone(before);
  evidence({
    ledger: before,
    pullRequest: pullRequest({ requested_reviewers: [actorResponse()] }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(before).toEqual(snapshot);
});

const humanGate = (result: ReturnType<typeof evidence>) => {
  const evaluated = evaluateEvidence(
    {
      ...passingFacts(),
      pullRequest: {
        ...passingPr(12),
        assignments: result.assignments,
        humanReviews: result.humanReviews,
      },
    },
    policy()
  );
  if (evaluated.status !== "evaluated") {
    throw new Error("fixture was not evaluated");
  }
  return evaluated.gates.find((gate) => gate.name === "human-review");
};

test("the evaluator accepts a bound approval from the assigned reviewer", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    pullRequest: pullRequest({ requested_reviewers: [actorResponse()] }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(humanGate(result)?.conclusion).toBe("success");
});

test("the evaluator blocks an unbound approval and an approval of an old base", () => {
  const unbound = evidence({
    pullRequest: pullRequest({ requested_reviewers: [actorResponse()] }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(humanGate(unbound)?.conclusion).toBe("failure");
  const moved = evidence({
    ledger: ledger({
      reviewBindings: {
        "900": {
          baseSha: OTHER,
          headSha: HEAD,
          observedAt: BEFORE,
          submittedAt: AFTER,
        },
      },
    }),
    pullRequest: pullRequest({ requested_reviewers: [actorResponse()] }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(humanGate(moved)?.conclusion).toBe("failure");
});
