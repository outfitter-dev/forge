import { expect, test } from "bun:test";

import {
  HumanReviewError,
  humanReviewEvidence,
} from "../src/human-review-evidence.ts";
import type { HumanReviewInput } from "../src/human-review-evidence.ts";
import { evaluateEvidence } from "../src/index.ts";
import type { HumanReviewEvidence } from "../src/index.ts";
import {
  parseBaseChanges,
  parsePullRequest,
  parseReviewRequests,
  parseReviews,
} from "../src/parse-github-pull-request.ts";
import type {
  RequiredReviewer,
  ReviewLedgerEntry,
} from "../src/review-ledger.ts";
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
  ghostResponse,
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
const READ = "2026-01-01T01:00:00Z";
const EARLY = "2026-01-01T00:05:00Z";
const BETWEEN = "2026-01-01T00:15:00Z";
const PAST = "2026-01-01T00:30:00Z";

const user = (login = "reviewer", id = 7): RequiredReviewer => ({
  id,
  kind: "user",
  login,
});

const team = (slug = "maintainers", id = 31): RequiredReviewer => ({
  id,
  kind: "team",
  slug,
});

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
    baseChanges: [],
    ledger: ledger(),
    pullRequest: pullRequest(),
    pullRequestReadAt: READ,
    repository: REPOSITORY,
    requests: [],
    reviews: [],
    ...input,
  });

const approvedAt = (
  baseSha: string,
  reviewer = "reviewer (user 7)"
): HumanReviewEvidence => ({
  reviewer,
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
    requiredReviewers: ["reviewer (user 7)"],
  });
  expect(result.ledger.requiredReviewers).toEqual([user()]);
});

test("the ledger keeps a requirement that GitHub no longer shows", () => {
  const result = evidence({
    ledger: ledger({ requiredReviewers: [user("earlier", 5)] }),
    pullRequest: pullRequest({ requested_reviewers: [actorResponse()] }),
  });
  expect(result.assignments.requiredReviewers).toEqual([
    "earlier (user 5)",
    "reviewer (user 7)",
  ]);
  expect(result.ledger.requiredReviewers).toEqual([user("earlier", 5), user()]);
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
    "maintainers (team 31)",
    "security (team 32)",
  ]);
  expect(result.ledger.requiredReviewers).toEqual([
    team(),
    team("security", 32),
  ]);
  expect(result.humanReviews.map((review) => review.reviewer)).toEqual([
    "reviewer (user 7)",
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
    {
      reviewer: "reviewer (user 7)",
      state: "changes_requested",
      subject: null,
    },
  ]);
});

test("a dismissed approval no longer approves", () => {
  const result = evidence({
    reviews: reviews({ state: "DISMISSED", submitted_at: AFTER }),
  });
  expect(result.humanReviews).toEqual([
    { reviewer: "reviewer (user 7)", state: "dismissed", subject: null },
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

// The parser already refuses these, so this guards a caller that builds
// reviews some other way.
test.each([
  { submittedAt: null },
  { submittedAt: "yesterday" },
  { submittedAt: "2026-01-01T00:10:00" },
  { submittedAt: "2026-01-01T00:10:00.500Z" },
  { submittedAt: "2026-02-30T00:10:00Z" },
])("a decision without a readable UTC time stops collection %p", (broken) => {
  const parsed = reviews(
    { id: 1, submitted_at: AFTER },
    { id: 2, submitted_at: AFTER }
  );
  expect(() =>
    evidence({ reviews: [at(parsed, 0), { ...at(parsed, 1), ...broken }] })
  ).toThrow(HumanReviewError);
});

test("an approval first seen with no earlier snapshot stays unbound", () => {
  const result = evidence({ reviews: reviews({ submitted_at: AFTER }) });
  expect(result.humanReviews).toEqual([
    { reviewer: "reviewer (user 7)", state: "approved", subject: null },
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
      base: {
        ref: "main",
        repo: { full_name: REPOSITORY, id: 100 },
        sha: OTHER,
      },
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
  const before = ledger({
    observedRevision: observed(),
    requiredReviewers: [user("old-name")],
  });
  const snapshot = structuredClone(before);
  evidence({
    ledger: before,
    pullRequest: pullRequest({ requested_reviewers: [actorResponse()] }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(before).toEqual(snapshot);
});

const humanGate = (result: ReturnType<typeof evidence>, headSha = HEAD) => {
  const evaluated = evaluateEvidence(
    {
      ...passingFacts(),
      pullRequest: {
        ...passingPr(12, headSha),
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

const assigned = () => pullRequest({ requested_reviewers: [actorResponse()] });

test("a base change after the snapshot refuses a new binding", () => {
  const snapshot = ledger({ observedRevision: observed() });
  const moved = evidence({
    baseChanges: parseBaseChanges([
      { created_at: "2026-01-01T00:05:00Z", event: "base_ref_changed" },
    ]),
    ledger: snapshot,
    pullRequest: assigned(),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(at(moved.humanReviews).subject).toBeNull();
  expect(moved.ledger.reviewBindings).toEqual({});
  expect(humanGate(moved)?.conclusion).toBe("failure");
});

test.each([
  {
    at: BEFORE,
    event: "base_ref_force_pushed",
    name: "at the snapshot instant",
  },
  { at: LATER, event: "base_ref_changed", name: "after the approval" },
])(
  "a base change $name also refuses the binding",
  ({ at: createdAt, event }) => {
    const result = evidence({
      baseChanges: parseBaseChanges([{ created_at: createdAt, event }]),
      ledger: ledger({ observedRevision: observed() }),
      reviews: reviews({ submitted_at: AFTER }),
    });
    expect(at(result.humanReviews).subject).toBeNull();
  }
);

test("a base change before the snapshot leaves the binding rule alone", () => {
  const result = evidence({
    baseChanges: parseBaseChanges([
      { created_at: "2025-12-31T23:00:00Z", event: "base_ref_changed" },
    ]),
    ledger: ledger({ observedRevision: observed() }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(result.humanReviews).toEqual([approvedAt(BASE)]);
});

test("a recorded binding does not follow the head when the head moves", () => {
  const result = evidence({
    ledger: ledger({
      reviewBindings: {
        "900": {
          baseSha: BASE,
          headSha: HEAD,
          observedAt: BEFORE,
          submittedAt: AFTER,
        },
      },
    }),
    pullRequest: pullRequest({
      head: { ref: "feature", repo: { id: 100 }, sha: OTHER },
      requested_reviewers: [actorResponse()],
    }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(result.humanReviews).toEqual([approvedAt(BASE)]);
  expect(humanGate(result, OTHER)?.conclusion).toBe("failure");
});

test("a recorded binding with another submission time binds nothing", () => {
  const result = evidence({
    ledger: ledger({
      reviewBindings: {
        "900": {
          baseSha: BASE,
          headSha: HEAD,
          observedAt: BEFORE,
          submittedAt: LATER,
        },
      },
    }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(at(result.humanReviews).subject).toBeNull();
});

test("one reviewer's approval does not hide another's change request", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    pullRequest: assigned(),
    reviews: reviews(
      {
        id: 1,
        state: "CHANGES_REQUESTED",
        submitted_at: AFTER,
        user: actorResponse("zed", 8),
      },
      { id: 2, submitted_at: LATER }
    ),
  });
  expect(result.humanReviews).toEqual([
    approvedAt(BASE),
    { reviewer: "zed (user 8)", state: "changes_requested", subject: null },
  ]);
  expect(humanGate(result)?.conclusion).toBe("failure");
});

test("reviewers and requirements come out sorted whatever order they arrive in", () => {
  const result = evidence({
    ledger: ledger({ requiredReviewers: [user("zed", 8), user("amy", 6)] }),
    pullRequest: pullRequest({
      requested_reviewers: [actorResponse("mia", 9)],
    }),
    reviews: reviews(
      { id: 1, submitted_at: AFTER, user: actorResponse("zed", 8) },
      { id: 2, submitted_at: AFTER, user: actorResponse("amy", 6) }
    ),
  });
  expect(result.assignments.requiredReviewers).toEqual([
    "amy (user 6)",
    "mia (user 9)",
    "zed (user 8)",
  ]);
  expect(result.humanReviews.map((review) => review.reviewer)).toEqual([
    "amy (user 6)",
    "zed (user 8)",
  ]);
});

test("a dismissed later review does not clear an earlier change request", () => {
  const result = evidence({
    reviews: reviews(
      { id: 1, state: "CHANGES_REQUESTED", submitted_at: AFTER },
      { id: 2, state: "DISMISSED", submitted_at: LATER }
    ),
  });
  expect(result.humanReviews).toEqual([
    {
      reviewer: "reviewer (user 7)",
      state: "changes_requested",
      subject: null,
    },
  ]);
  expect(humanGate(result)?.conclusion).toBe("failure");
});

test("a dismissed later review does not bring back an earlier approval", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    reviews: reviews(
      { id: 1, submitted_at: AFTER },
      { id: 2, state: "DISMISSED", submitted_at: LATER }
    ),
  });
  expect(result.humanReviews).toEqual([
    { reviewer: "reviewer (user 7)", state: "dismissed", subject: null },
  ]);
});

test("each review by a deleted account stands alone and never approves", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    pullRequest: pullRequest({ user: ghostResponse() }),
    reviews: reviews(
      {
        id: 1,
        state: "CHANGES_REQUESTED",
        submitted_at: AFTER,
        user: ghostResponse(),
      },
      { id: 2, submitted_at: LATER, user: ghostResponse() }
    ),
  });
  expect(result.humanReviews).toEqual([
    { reviewer: "ghost#1", state: "changes_requested", subject: null },
    { reviewer: "ghost#2", state: "approved", subject: null },
  ]);
  expect(result.ledger.reviewBindings).toEqual({});
  expect(humanGate(result)?.conclusion).toBe("failure");
});

test("the result shares no objects with the ledger passed in", () => {
  const before = ledger({
    observedRevision: observed(),
    requiredReviewers: [user()],
    reviewBindings: {
      "7": {
        baseSha: BASE,
        headSha: HEAD,
        observedAt: BEFORE,
        submittedAt: AFTER,
      },
    },
  });
  const result = evidence({ ledger: before });
  expect(at(result.ledger.requiredReviewers)).not.toBe(
    at(before.requiredReviewers)
  );
  expect(result.ledger.observedRevision).not.toBe(before.observedRevision);
  expect(result.ledger.reviewBindings["7"]).not.toBe(
    before.reviewBindings["7"]
  );
  expect(result.ledger).toEqual(before);
});

test.each([
  { name: "at the instant of the read", readAt: AFTER },
  { name: "after the read", readAt: "2026-01-01T00:09:59Z" },
  { name: "when the read time is unreadable", readAt: "just now" },
])(
  "an approval submitted $name is left for the next collection",
  ({ readAt }) => {
    const result = evidence({
      ledger: ledger({ observedRevision: observed() }),
      pullRequest: assigned(),
      pullRequestReadAt: readAt,
      reviews: reviews({ submitted_at: AFTER }),
    });
    expect(at(result.humanReviews).subject).toBeNull();
    expect(result.ledger.reviewBindings).toEqual({});
    expect(humanGate(result)?.conclusion).toBe("failure");
  }
);

test.each([{ order: [0, 2] }, { order: [2, 0] }])(
  "an approval and a change request submitted together block in order $order",
  ({ order }) => {
    const result = evidence({
      ledger: ledger({ observedRevision: observed() }),
      reviews: reviews(...order.map((index) => at(TIED, index))),
    });
    expect(result.humanReviews).toEqual([
      {
        reviewer: "reviewer (user 7)",
        state: "changes_requested",
        subject: null,
      },
    ]);
    expect(humanGate(result)?.conclusion).toBe("failure");
  }
);

test("a stack change after the snapshot refuses a new binding", () => {
  const result = evidence({
    baseChanges: parseBaseChanges([
      { created_at: "2026-01-01T00:05:00Z", event: "removed_from_stack" },
    ]),
    ledger: ledger({ observedRevision: observed() }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(at(result.humanReviews).subject).toBeNull();
});

test("a base change with an unreadable time refuses a new binding", () => {
  const result = evidence({
    baseChanges: [{ createdAt: "some time ago", event: "base_ref_changed" }],
    ledger: ledger({ observedRevision: observed() }),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(at(result.humanReviews).subject).toBeNull();
});

test("a requested reviewer whose account was deleted stays required and unmet", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    pullRequest: pullRequest({ requested_reviewers: [ghostResponse()] }),
    reviews: reviews({ submitted_at: AFTER, user: ghostResponse() }),
  });
  expect(result.assignments.requiredReviewers).toEqual(["ghost (user 10137)"]);
  expect(result.ledger.requiredReviewers).toEqual([user("ghost", 10_137)]);
  expect(result.humanReviews).toEqual([
    { reviewer: "ghost#900", state: "approved", subject: null },
  ]);
  expect(humanGate(result)?.conclusion).toBe("failure");
});

test("the first collection records the revision it read, at the time it read it", () => {
  expect(evidence().ledger.observedRevision).toEqual(observed(READ));
});

test("an unchanged revision keeps its earlier snapshot", () => {
  const result = evidence({ ledger: ledger({ observedRevision: observed() }) });
  expect(result.ledger.observedRevision).toEqual(observed(BEFORE));
});

test.each([
  {
    expected: observed(READ, OTHER),
    input: {
      pullRequest: pullRequest({
        head: { ref: "feature", repo: { id: 100 }, sha: OTHER },
      }),
    },
    name: "the head moved",
  },
  {
    expected: observed(READ, HEAD, OTHER),
    input: {
      pullRequest: pullRequest({
        base: {
          ref: "main",
          repo: { full_name: REPOSITORY, id: 100 },
          sha: OTHER,
        },
      }),
    },
    name: "the base moved",
  },
  {
    expected: observed(READ),
    input: {
      baseChanges: parseBaseChanges([
        { created_at: AFTER, event: "base_ref_force_pushed" },
      ]),
    },
    name: "the base may have changed since",
  },
  {
    expected: observed(READ),
    input: { ledger: ledger({ observedRevision: observed("long ago") }) },
    name: "its own time is unreadable",
  },
])("a snapshot is replaced when $name", ({ expected, input }) => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    ...input,
  });
  expect(result.ledger.observedRevision).toEqual(expected);
});

test("an unreadable read time records no new snapshot", () => {
  const result = evidence({ pullRequestReadAt: "just now" });
  expect(result.ledger.observedRevision).toBeNull();
});

test("an approval in the same second as a read binds at the next collection", () => {
  const approval = reviews({ submitted_at: AFTER });
  const first = evidence({
    ledger: ledger({ observedRevision: observed() }),
    pullRequest: assigned(),
    pullRequestReadAt: AFTER,
    reviews: approval,
  });
  expect(at(first.humanReviews).subject).toBeNull();
  const second = evidence({
    ledger: first.ledger,
    pullRequest: assigned(),
    pullRequestReadAt: LATER,
    reviews: approval,
  });
  expect(second.humanReviews).toEqual([approvedAt(BASE)]);
  expect(humanGate(second)?.conclusion).toBe("success");
});

test("an approval one collection did not see binds at the next", () => {
  const first = evidence({
    ledger: ledger({ observedRevision: observed() }),
    pullRequest: assigned(),
    pullRequestReadAt: LATER,
  });
  const second = evidence({
    ledger: first.ledger,
    pullRequest: assigned(),
    reviews: reviews({ submitted_at: AFTER }),
  });
  expect(second.humanReviews).toEqual([approvedAt(BASE)]);
  expect(humanGate(second)?.conclusion).toBe("success");
});

test("an approval in the same second as the read that first records a revision never binds", () => {
  const approval = reviews({ submitted_at: AFTER });
  const first = evidence({
    pullRequest: assigned(),
    pullRequestReadAt: AFTER,
    reviews: approval,
  });
  expect(first.ledger.observedRevision).toEqual(observed(AFTER));
  const second = evidence({
    ledger: first.ledger,
    pullRequest: assigned(),
    pullRequestReadAt: LATER,
    reviews: approval,
  });
  expect(at(second.humanReviews).subject).toBeNull();
  expect(second.ledger.reviewBindings).toEqual({});
  expect(humanGate(second)?.conclusion).toBe("failure");
});

test("a snapshot later than the read is kept, and nothing binds at that collection", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed(LATER) }),
    pullRequest: assigned(),
    pullRequestReadAt: AFTER,
    reviews: reviews({ submitted_at: EARLY }),
  });
  expect(result.ledger.observedRevision).toEqual(observed(LATER));
  expect(at(result.humanReviews).subject).toBeNull();
  expect(result.ledger.reviewBindings).toEqual({});
  expect(humanGate(result)?.conclusion).toBe("failure");
});

test("once a read passes a kept snapshot's time, only an approval after that time binds", () => {
  const first = evidence({
    ledger: ledger({ observedRevision: observed(LATER) }),
    pullRequest: assigned(),
    pullRequestReadAt: AFTER,
  });
  const tooEarly = evidence({
    ledger: first.ledger,
    pullRequest: assigned(),
    reviews: reviews({ submitted_at: BETWEEN }),
  });
  expect(at(tooEarly.humanReviews).subject).toBeNull();
  expect(humanGate(tooEarly)?.conclusion).toBe("failure");
  const second = evidence({
    ledger: first.ledger,
    pullRequest: assigned(),
    reviews: reviews({ submitted_at: PAST }),
  });
  expect(second.ledger.observedRevision).toEqual(observed(LATER));
  expect(second.humanReviews).toEqual([approvedAt(BASE)]);
  expect(humanGate(second)?.conclusion).toBe("success");
});

const reasonCodes = (result: ReturnType<typeof evidence>) =>
  humanGate(result)?.reasons.map((item) => item.code);

test("a required reviewer who changed login is one requirement their approval meets", () => {
  const result = evidence({
    ledger: ledger({
      observedRevision: observed(),
      requiredReviewers: [user("old-name")],
    }),
    reviews: reviews({ submitted_at: AFTER, user: actorResponse("new-name") }),
  });
  expect(result.assignments.requiredReviewers).toEqual(["new-name (user 7)"]);
  expect(result.ledger.requiredReviewers).toEqual([user("new-name")]);
  expect(result.humanReviews).toEqual([approvedAt(BASE, "new-name (user 7)")]);
  expect(humanGate(result)?.conclusion).toBe("success");
});

test("a ledger entry takes the login GitHub shows now", () => {
  const result = evidence({
    ledger: ledger({ requiredReviewers: [user("old-name")] }),
    requests: parseReviewRequests([
      reviewRequestedEvent({ requested_reviewer: actorResponse("new-name") }),
    ]),
  });
  expect(result.assignments.requiredReviewers).toEqual(["new-name (user 7)"]);
  expect(result.ledger.requiredReviewers).toEqual([user("new-name")]);
});

test("another account holding a required reviewer's old login does not meet the requirement", () => {
  const result = evidence({
    ledger: ledger({
      observedRevision: observed(),
      requiredReviewers: [user()],
    }),
    reviews: reviews({
      submitted_at: AFTER,
      user: actorResponse("reviewer", 99),
    }),
  });
  expect(result.assignments.requiredReviewers).toEqual(["reviewer (user 7)"]);
  expect(result.ledger.requiredReviewers).toEqual([user()]);
  expect(result.humanReviews).toEqual([approvedAt(BASE, "reviewer (user 99)")]);
  expect(humanGate(result)?.conclusion).toBe("failure");
  expect(reasonCodes(result)).toEqual(["approval-required"]);
});

test("a change request from the account holding an old login is its own reviewer", () => {
  const result = evidence({
    ledger: ledger({
      observedRevision: observed(),
      requiredReviewers: [user()],
    }),
    reviews: reviews(
      { id: 1, submitted_at: AFTER, user: actorResponse("renamed") },
      {
        id: 2,
        state: "CHANGES_REQUESTED",
        submitted_at: LATER,
        user: actorResponse("reviewer", 99),
      }
    ),
  });
  expect(result.assignments.requiredReviewers).toEqual(["renamed (user 7)"]);
  expect(result.humanReviews).toEqual([
    approvedAt(BASE, "renamed (user 7)"),
    {
      reviewer: "reviewer (user 99)",
      state: "changes_requested",
      subject: null,
    },
  ]);
  expect(reasonCodes(result)).toEqual(["changes-requested"]);
});

test("two accounts with one login in the same response are two reviewers", () => {
  const result = evidence({
    ledger: ledger({ observedRevision: observed() }),
    pullRequest: pullRequest({
      requested_reviewers: [actorResponse("twin", 22)],
    }),
    reviews: reviews(
      {
        id: 1,
        state: "CHANGES_REQUESTED",
        submitted_at: AFTER,
        user: actorResponse("twin", 21),
      },
      { id: 2, submitted_at: LATER, user: actorResponse("twin", 22) }
    ),
  });
  expect(result.humanReviews).toEqual([
    { reviewer: "twin (user 21)", state: "changes_requested", subject: null },
    approvedAt(BASE, "twin (user 22)"),
  ]);
  expect(reasonCodes(result)).toEqual(["changes-requested"]);
});

test("a team that changed slug is one requirement", () => {
  const result = evidence({
    ledger: ledger({ requiredReviewers: [team()] }),
    pullRequest: pullRequest({ requested_teams: [teamResponse("platform")] }),
  });
  expect(result.assignments.requiredReviewers).toEqual(["platform (team 31)"]);
  expect(result.ledger.requiredReviewers).toEqual([team("platform")]);
});

// A name is free text here: the label must keep kinds apart whatever it holds.
test.each([
  { login: "reviewer" },
  { login: "core" },
  { login: "team:core" },
  { login: "core (team 7)" },
  { login: "(team 7)" },
])(
  "a person named $login does not meet a team requirement that has the same number",
  ({ login }) => {
    const result = evidence({
      ledger: ledger({ observedRevision: observed() }),
      pullRequest: pullRequest({ requested_teams: [teamResponse("core", 7)] }),
      reviews: reviews({ submitted_at: AFTER, user: actorResponse(login) }),
    });
    expect(result.assignments.requiredReviewers).toEqual(["core (team 7)"]);
    expect(result.humanReviews).toEqual([
      approvedAt(BASE, `${login} (user 7)`),
    ]);
    expect(humanGate(result)?.conclusion).toBe("failure");
    expect(reasonCodes(result)).toEqual(["approval-required"]);
  }
);

test("a team named like a person's label does not stand in for that person", () => {
  const result = evidence({
    ledger: ledger({
      observedRevision: observed(),
      requiredReviewers: [user()],
    }),
    pullRequest: pullRequest({
      requested_teams: [teamResponse("reviewer (user 7)", 7)],
    }),
  });
  expect(result.assignments.requiredReviewers).toEqual([
    "reviewer (user 7)",
    "reviewer (user 7) (team 7)",
  ]);
  expect(reasonCodes(result)).toEqual([
    "approval-required",
    "approval-required",
  ]);
});

test("the requirements do not depend on the order anything arrives in", () => {
  const collect = (reversed: boolean) => {
    const inOrder = <T>(items: T[]): T[] =>
      reversed ? items.toReversed() : items;
    return evidence({
      ledger: ledger({
        requiredReviewers: inOrder([
          user("zed", 8),
          team("security", 32),
          user("amy", 6),
          team(),
        ]),
      }),
      pullRequest: pullRequest({
        requested_reviewers: inOrder([
          actorResponse("mia", 9),
          actorResponse("bob", 4),
        ]),
      }),
      requests: parseReviewRequests(
        inOrder([
          reviewRequestedEvent({ requested_reviewer: actorResponse("zed", 8) }),
          reviewRequestedEvent({
            requested_reviewer: undefined,
            requested_team: teamResponse("docs", 30),
          }),
        ])
      ),
    });
  };
  const forward = collect(false);
  expect(collect(true)).toEqual(forward);
  expect(forward.ledger.requiredReviewers).toEqual([
    team("docs", 30),
    team(),
    team("security", 32),
    user("bob", 4),
    user("amy", 6),
    user("zed", 8),
    user("mia", 9),
  ]);
  expect(forward.assignments.requiredReviewers).toEqual([
    "amy (user 6)",
    "bob (user 4)",
    "docs (team 30)",
    "maintainers (team 31)",
    "mia (user 9)",
    "security (team 32)",
    "zed (user 8)",
  ]);
});

test("an account named two ways in one collection gets one name in either order", () => {
  const events = [
    reviewRequestedEvent({ requested_reviewer: actorResponse("new-name") }),
    reviewRequestedEvent({ requested_reviewer: actorResponse("old-name") }),
  ];
  const forward = evidence({ requests: parseReviewRequests(events) });
  const backward = evidence({
    requests: parseReviewRequests(events.toReversed()),
  });
  expect(forward.ledger.requiredReviewers).toEqual([user("new-name")]);
  expect(backward).toEqual(forward);
});
