import { expect, test } from "bun:test";

import { collectPullRequest, evaluateEvidence } from "../src/index.ts";
import type {
  CollectedPullRequestEvidence,
  GateName,
  PullRequestCollectionRequest,
  PullRequestCollectionResult,
  PullRequestReads,
  ReviewLedgerEntry,
} from "../src/index.ts";
import { passingPrV2, policyV2 } from "./agent-review-fixtures.ts";
import { at, provenance, REPOSITORY, subject } from "./evidence-fixtures.ts";
import {
  actorResponse,
  BASE,
  HEAD,
  pullRequestResponse,
  reviewRequestedEvent,
  reviewResponse,
  teamResponse,
  threadPageResponse,
} from "./github-fixtures.ts";

const OTHER = "c".repeat(40);
const BEFORE = "2026-01-01T00:00:00Z";
const EARLY = "2026-01-01T00:05:00Z";
const APPROVED = "2026-01-01T00:10:00Z";
const READ = "2026-01-01T01:00:00Z";
const HOLD = "forge:hold";
const REVIEWER = "reviewer (user 7)";
/** Shaped like a credential, so a leak into a result is easy to see. */
const SECRET = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";

/** What one pass of reads is answered with, as raw responses. */
interface Pass {
  pullRequest: unknown;
  reviews: unknown;
  servedAt: string;
  /** Review-thread pages in order; see `pages`. */
  threads: unknown[];
  timeline: unknown;
}

const pr = (overrides: Record<string, unknown> = {}) =>
  pullRequestResponse({
    requested_reviewers: [],
    requested_teams: [],
    ...overrides,
  });

const baseAt = (sha: string, repository = REPOSITORY) => ({
  ref: "main",
  repo: { full_name: repository, id: 100 },
  sha,
});

/** Thread pages chained by cursor: page N is asked for with `cursor-N`. */
const pages = (...resolved: unknown[][]): unknown[] =>
  resolved.map((page, index) =>
    threadPageResponse(
      page,
      index + 1 < resolved.length
        ? { endCursor: `cursor-${index + 1}`, hasNextPage: true }
        : { endCursor: null, hasNextPage: false }
    )
  );

const pass = (overrides: Partial<Pass> = {}): Pass => ({
  pullRequest: pr(),
  reviews: [],
  servedAt: READ,
  threads: pages([]),
  timeline: [],
  ...overrides,
});

/** The reviewer was asked and approved the head. */
const approvedPass = (overrides: Partial<Pass> = {}): Pass =>
  pass({
    reviews: [reviewResponse({ submitted_at: APPROVED })],
    timeline: [reviewRequestedEvent()],
    ...overrides,
  });

/**
 * Reads answered from scripted passes, recording the order they are made in.
 * The nth call of a read is answered from the nth pass, and any later call
 * from the last one.
 */
const scripted = (first: Pass, second: Pass = first) => {
  const calls: string[] = [];
  const passes = [first, second];
  const made = { pullRequest: 0, reviews: 0, threads: 0, timeline: 0 };
  const answer = (read: keyof typeof made): Pass => {
    const current = at(passes, Math.min(made[read], passes.length - 1));
    made[read] += 1;
    return current;
  };
  let paging = first;
  const reads: PullRequestReads = {
    pullRequest: () => {
      calls.push("pullRequest");
      const { pullRequest: body, servedAt } = answer("pullRequest");
      return Promise.resolve({ body, servedAt });
    },
    reviewThreads: (cursor) => {
      calls.push(`threads:${cursor}`);
      if (cursor === null) {
        paging = answer("threads");
      }
      const page = cursor === null ? 0 : Number(cursor.slice("cursor-".length));
      return Promise.resolve(paging.threads[page]);
    },
    reviews: () => {
      calls.push("reviews");
      return Promise.resolve(answer("reviews").reviews);
    },
    timeline: () => {
      calls.push("timeline");
      return Promise.resolve(answer("timeline").timeline);
    },
  };
  return { calls, reads };
};

const ledger = (
  overrides: Partial<ReviewLedgerEntry> = {}
): ReviewLedgerEntry => ({
  observedRevision: null,
  requiredReviewers: [],
  reviewBindings: {},
  ...overrides,
});

/** A ledger that saw this head and base before the approval was submitted. */
const snapshot = () =>
  ledger({
    observedRevision: { baseSha: BASE, headSha: HEAD, observedAt: BEFORE },
  });

const request = (
  overrides: Partial<PullRequestCollectionRequest> = {}
): PullRequestCollectionRequest => ({
  holdLabel: HOLD,
  ledger: ledger(),
  maxThreadPages: 5,
  provenance: provenance("collector"),
  pullRequest: 12,
  repository: REPOSITORY,
  ...overrides,
});

const collect = (
  first: Pass,
  second?: Pass,
  overrides?: Partial<PullRequestCollectionRequest>
) => collectPullRequest(request(overrides), scripted(first, second).reads);

const collected = (result: PullRequestCollectionResult) => {
  if (result.status !== "collected") {
    throw new Error(`collection stopped: ${result.status}`);
  }
  return result;
};

/** The real evaluator, given the collection beside passing version 2 evidence. */
const evaluate = (evidence: CollectedPullRequestEvidence) => {
  const evaluated = evaluateEvidence(
    {
      event: "pull_request",
      pullRequest: { ...passingPrV2(12), ...evidence },
      schemaVersion: 2,
    },
    policyV2()
  );
  if (evaluated.status !== "evaluated") {
    throw new Error("fixture was not evaluated");
  }
  return {
    eligible: evaluated.eligible,
    gate: (name: GateName) => {
      const decision = evaluated.gates.find((item) => item.name === name);
      return {
        conclusion: decision?.conclusion,
        paths: decision?.reasons.map((item) => item.path),
      };
    },
  };
};

const FIRST_PASS = ["reviews", "pullRequest", "timeline", "threads:null"];
const SECOND_PASS = ["pullRequest", "reviews", "timeline", "threads:null"];

test("a stable collection is evidence the evaluator accepts", async () => {
  const result = collected(
    await collect(approvedPass(), undefined, { ledger: snapshot() })
  );
  expect(result.evidence).toStrictEqual({
    assignments: { recorded: true, requiredReviewers: [REVIEWER] },
    draft: false,
    humanReviews: [
      { reviewer: REVIEWER, state: "approved", subject: subject(12) },
    ],
    mergeAuthorized: true,
    mergeable: true,
    open: true,
    provenance: provenance("collector"),
    subject: subject(12),
    unresolvedThreads: 0,
  });
  expect(result.ledger).toEqual({
    observedRevision: { baseSha: BASE, headSha: HEAD, observedAt: BEFORE },
    requiredReviewers: [{ id: 7, kind: "user", login: "reviewer" }],
    reviewBindings: {
      "900": {
        baseSha: BASE,
        headSha: HEAD,
        observedAt: BEFORE,
        submittedAt: APPROVED,
      },
    },
  });
  const evaluated = evaluate(result.evidence);
  expect(evaluated.gate("human-review").conclusion).toBe("success");
  expect(evaluated.gate("mergeability").conclusion).toBe("success");
  expect(evaluated.eligible).toBe(true);
});

test("the first pass reads reviews, then the pull request, then the timeline, then threads, and the second pass reads all four again", async () => {
  const fixture = scripted(pass());
  await collectPullRequest(request(), fixture.reads);
  expect(fixture.calls).toEqual([...FIRST_PASS, ...SECOND_PASS]);
});

test("only an approval submitted before the first pull request read is bound", async () => {
  const approval = {
    reviews: [reviewResponse({ submitted_at: "2026-01-01T00:40:00Z" })],
    timeline: [reviewRequestedEvent()],
  };
  const result = collected(
    await collect(
      pass({ ...approval, servedAt: "2026-01-01T00:30:00Z" }),
      pass({ ...approval, servedAt: "2026-01-01T00:50:00Z" }),
      { ledger: snapshot() }
    )
  );
  expect(at(result.evidence.humanReviews).subject).toBeNull();
  expect(result.ledger.reviewBindings).toEqual({});
  expect(evaluate(result.evidence).gate("human-review").conclusion).toBe(
    "failure"
  );
});

test("a head that moves between the passes stops the collection and returns no ledger", async () => {
  const moved = pr({ head: { ref: "feature", repo: { id: 100 }, sha: OTHER } });
  const result = await collect(
    approvedPass(),
    approvedPass({ pullRequest: moved }),
    { ledger: snapshot() }
  );
  expect(result).toStrictEqual({
    reason: "pull-request-changed",
    status: "changed",
  });
  expect(result).not.toHaveProperty("ledger");
});

type ChangedReason = Extract<
  PullRequestCollectionResult,
  { status: "changed" }
>["reason"];

test.each<{ name: string; reason: ChangedReason; first?: Pass; second: Pass }>([
  {
    name: "the base commit moves",
    reason: "pull-request-changed",
    second: pass({ pullRequest: pr({ base: baseAt(OTHER) }) }),
  },
  {
    name: "the base branch is another one",
    reason: "pull-request-changed",
    second: pass({
      pullRequest: pr({ base: { ...baseAt(BASE), ref: "release" } }),
    }),
  },
  {
    name: "it becomes a draft",
    reason: "pull-request-changed",
    second: pass({ pullRequest: pr({ draft: true }) }),
  },
  {
    name: "it is closed",
    reason: "pull-request-changed",
    second: pass({ pullRequest: pr({ state: "closed" }) }),
  },
  {
    name: "a label is added",
    reason: "pull-request-changed",
    second: pass({
      pullRequest: pr({
        labels: [
          { id: 5, name: "docs" },
          { id: 6, name: "bug" },
        ],
      }),
    }),
  },
  {
    name: "the hold label appears",
    reason: "pull-request-changed",
    second: pass({ pullRequest: pr({ labels: [{ id: 9, name: HOLD }] }) }),
  },
  {
    first: pass({ pullRequest: pr({ mergeable: null }) }),
    name: "GitHub computes mergeable",
    reason: "pull-request-changed",
    second: pass({ pullRequest: pr({ mergeable: true }) }),
  },
  {
    name: "a reviewer is requested on the pull request",
    reason: "pull-request-changed",
    second: pass({
      pullRequest: pr({ requested_reviewers: [actorResponse()] }),
    }),
  },
  {
    name: "a team is requested on the pull request",
    reason: "pull-request-changed",
    second: pass({ pullRequest: pr({ requested_teams: [teamResponse()] }) }),
  },
  {
    name: "a review arrives",
    reason: "reviews-changed",
    second: pass({ reviews: [reviewResponse()] }),
  },
  {
    name: "a review request is recorded",
    reason: "timeline-changed",
    second: pass({ timeline: [reviewRequestedEvent()] }),
  },
  {
    name: "a base change is recorded",
    reason: "timeline-changed",
    second: pass({
      timeline: [{ created_at: APPROVED, event: "base_ref_changed" }],
    }),
  },
  {
    name: "a review thread is opened",
    reason: "threads-changed",
    second: pass({ threads: pages([false]) }),
  },
])(
  "the collection is refused as changed when $name between the passes",
  async ({ first, reason, second }) => {
    const result = await collect(first ?? pass(), second);
    expect(result).toStrictEqual({ reason, status: "changed" });
  }
);

test("a difference no decision reads does not refuse the collection", async () => {
  const result = await collect(
    pass(),
    pass({
      pullRequest: pr({ title: "Retitled between the passes" }),
      servedAt: "2026-01-01T01:00:09Z",
      timeline: [{ event: "commented", id: 77 }],
    })
  );
  expect(result.status).toBe("collected");
});

test("mergeable that GitHub has not computed stays unknown and blocks landing", async () => {
  const result = collected(
    await collect(pass({ pullRequest: pr({ mergeable: null }) }))
  );
  expect(result.evidence.mergeable).toBeNull();
  expect(evaluate(result.evidence).gate("mergeability")).toEqual({
    conclusion: "failure",
    paths: ["facts.pullRequest.mergeable"],
  });
});

test.each([
  { fact: "open", observed: { state: "closed" }, value: false },
  { fact: "draft", observed: { draft: true }, value: true },
  { fact: "mergeable", observed: { mergeable: false }, value: false },
] as const)(
  "a pull request observed with $observed is collected with $fact $value and blocks landing",
  async ({ fact, observed, value }) => {
    const result = collected(
      await collect(pass({ pullRequest: pr(observed) }))
    );
    expect(result.evidence[fact]).toBe(value);
    expect(evaluate(result.evidence).gate("mergeability")).toEqual({
      conclusion: "failure",
      paths: [`facts.pullRequest.${fact}`],
    });
  }
);

test.each([{ name: HOLD }, { name: "Forge:Hold" }])(
  "a pull request labeled $name is not authorized to land",
  async ({ name }) => {
    const held = pr({
      labels: [
        { id: 5, name: "docs" },
        { id: 9, name },
      ],
    });
    const result = collected(await collect(pass({ pullRequest: held })));
    expect(result.evidence.mergeAuthorized).toBe(false);
    expect(evaluate(result.evidence).gate("mergeability")).toEqual({
      conclusion: "failure",
      paths: ["facts.pullRequest.mergeAuthorized"],
    });
  }
);

test("a pull request from the base repository without the hold label may land", async () => {
  const result = collected(
    await collect(pass({ pullRequest: pr({ labels: [] }) }))
  );
  expect(result.evidence.mergeAuthorized).toBe(true);
});

/** Whether a base-repository pull request carrying these labels may land under this hold label. */
const mayLand = async (labels: readonly string[], holdLabel: string) => {
  const labeled = pr({
    labels: labels.map((name, index) => ({ id: index + 1, name })),
  });
  const result = collected(
    await collect(pass({ pullRequest: labeled }), undefined, { holdLabel })
  );
  return result.evidence.mergeAuthorized;
};

const OTHER_HOLD = "do not land";
/** The Kelvin sign, which a Unicode lower-casing turns into the letter k. */
const KELVIN = "K";
/** The long s, which looks like an f. */
const LONG_S = "ſ";

test.each([
  { hold: HOLD, labels: [HOLD, "docs"] },
  { hold: HOLD, labels: ["docs", "FORGE:HOLD", "bug"] },
  { hold: OTHER_HOLD, labels: [OTHER_HOLD] },
  { hold: OTHER_HOLD, labels: ["Do Not Land", "docs"] },
])(
  "labels $labels hold a pull request under the hold label $hold",
  async ({ hold, labels }) => {
    expect(await mayLand(labels, hold)).toBe(false);
  }
);

test.each([
  { hold: OTHER_HOLD, labels: [HOLD] },
  { hold: HOLD, labels: [OTHER_HOLD] },
  { hold: HOLD, labels: ["not-forge:hold"] },
  { hold: HOLD, labels: ["forge:hold-later"] },
  { hold: HOLD, labels: ["hold"] },
  { hold: HOLD, labels: [`${LONG_S}orge:hold`] },
  { hold: "blocked", labels: [`bloc${KELVIN}ed`] },
])(
  "labels $labels do not hold a pull request under the hold label $hold",
  async ({ hold, labels }) => {
    expect(await mayLand(labels, hold)).toBe(true);
  }
);

test.each([
  { from: "a fork", labels: [], repo: { id: 200 } },
  { from: "a fork", labels: [{ id: 9, name: HOLD }], repo: { id: 200 } },
  { from: "a deleted fork", labels: [], repo: null },
  { from: "a deleted fork", labels: [{ id: 9, name: HOLD }], repo: null },
])(
  "a pull request from $from with labels $labels is not authorized to land",
  async ({ labels, repo }) => {
    const outside = pr({ head: { ref: "feature", repo, sha: HEAD }, labels });
    const result = collected(await collect(pass({ pullRequest: outside })));
    expect(result.evidence.mergeAuthorized).toBe(false);
    expect(evaluate(result.evidence).gate("mergeability")).toEqual({
      conclusion: "failure",
      paths: ["facts.pullRequest.mergeAuthorized"],
    });
  }
);

const THREE_PAGES = pages([false, true], [false], [true, false]);

test("unresolved threads are counted across every page", async () => {
  const fixture = scripted(pass({ threads: THREE_PAGES }));
  const result = collected(
    await collectPullRequest(request({ maxThreadPages: 3 }), fixture.reads)
  );
  expect(result.evidence.unresolvedThreads).toBe(3);
  expect(fixture.calls.filter((call) => call.startsWith("threads"))).toEqual([
    "threads:null",
    "threads:cursor-1",
    "threads:cursor-2",
    "threads:null",
    "threads:cursor-1",
    "threads:cursor-2",
  ]);
  expect(evaluate(result.evidence).gate("mergeability")).toEqual({
    conclusion: "failure",
    paths: ["facts.pullRequest.unresolvedThreads"],
  });
});

test("a thread list that does not end within the page bound is unavailable", async () => {
  const fixture = scripted(pass({ threads: THREE_PAGES }));
  const result = await collectPullRequest(
    request({ maxThreadPages: 2 }),
    fixture.reads
  );
  expect(result).toStrictEqual({
    reason: "thread-pages-exceeded",
    status: "unavailable",
  });
  expect(fixture.calls.filter((call) => call.startsWith("threads"))).toEqual([
    "threads:null",
    "threads:cursor-1",
  ]);
});

test.each([
  { served: "example/other" },
  { served: "other/project" },
  { served: "example/project-2" },
  { served: "example/proj" },
])(
  "a response for $served is a mismatch with the requested repository",
  async ({ served }) => {
    const result = await collect(
      pass({ pullRequest: pr({ base: baseAt(BASE, served) }) })
    );
    expect(result).toStrictEqual({
      reason: "repository-mismatch",
      status: "mismatch",
    });
  }
);

test("a repository name that matches only by a Unicode case mapping is a mismatch", async () => {
  const result = await collect(
    pass({ pullRequest: pr({ base: baseAt(BASE, `example/${KELVIN}it`) }) }),
    undefined,
    { repository: "example/kit" }
  );
  expect(result).toStrictEqual({
    reason: "repository-mismatch",
    status: "mismatch",
  });
});

test("a repository name that differs only in case is the requested repository", async () => {
  const result = collected(
    await collect(
      pass({ pullRequest: pr({ base: baseAt(BASE, "Example/Project") }) })
    )
  );
  expect(result.evidence.subject).toEqual(subject(12));
});

test("a response for another pull request is a mismatch", async () => {
  const result = await collect(pass({ pullRequest: pr({ number: 13 }) }));
  expect(result).toStrictEqual({
    reason: "pull-request-mismatch",
    status: "mismatch",
  });
});

const UNREADABLE: { broken: Partial<Pass>; name: string; path: string }[] = [
  {
    broken: {
      pullRequest: pr({
        head: { ref: "feature", repo: { id: 100 }, sha: SECRET },
      }),
    },
    name: "pull request",
    path: "pullRequest.head.sha",
  },
  {
    broken: { reviews: [reviewResponse({ state: SECRET })] },
    name: "reviews",
    path: "reviews[0].state",
  },
  {
    broken: { timeline: [{ created_at: SECRET, event: "base_ref_changed" }] },
    name: "timeline",
    path: "timeline[0].created_at",
  },
  {
    broken: { threads: pages([SECRET]) },
    name: "review thread",
    path: "threads.data.repository.pullRequest.reviewThreads.nodes[0].isResolved",
  },
];

test.each(UNREADABLE)(
  "an unreadable $name response stops the collection with its path and none of its content",
  async ({ broken, path }) => {
    const result = await collect(pass(broken));
    expect(result).toStrictEqual({
      path,
      reason: "response-unreadable",
      status: "unreadable",
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  }
);

test.each(UNREADABLE)(
  "an unreadable $name response in the second pass stops the collection too",
  async ({ broken, path }) => {
    const result = await collect(pass(), pass(broken));
    expect(result).toStrictEqual({
      path,
      reason: "response-unreadable",
      status: "unreadable",
    });
  }
);

test.each(["pullRequest", "reviews", "timeline", "reviewThreads"] as const)(
  "a %s read that rejects is unavailable and nothing it threw is reported",
  async (read) => {
    const { reads } = scripted(pass());
    const result = await collectPullRequest(request(), {
      ...reads,
      [read]: () => Promise.reject(new Error(SECRET)),
    });
    expect(result).toStrictEqual({
      reason: "read-failed",
      status: "unavailable",
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  }
);

test("a read that throws before it returns a promise is unavailable", async () => {
  const { reads } = scripted(pass());
  const result = await collectPullRequest(request(), {
    ...reads,
    reviews: () => {
      throw new Error(SECRET);
    },
  });
  expect(result).toStrictEqual({
    reason: "read-failed",
    status: "unavailable",
  });
});

test.each([
  { inPass: 1, name: "undefined", resolved: undefined },
  { inPass: 1, name: "null", resolved: null },
  { inPass: 2, name: "undefined", resolved: undefined },
  { inPass: 2, name: "null", resolved: null },
])(
  "a pull request read that resolves $name in pass $inPass is unavailable",
  async ({ inPass, resolved }) => {
    const { reads } = scripted(pass());
    const answer = reads.pullRequest;
    let made = 0;
    // The interface forbids this answer, so the read is replaced behind its type.
    Reflect.set(reads, "pullRequest", () => {
      made += 1;
      return made === inPass ? Promise.resolve(resolved) : answer();
    });
    const result = await collectPullRequest(request(), reads);
    expect(result).toStrictEqual({
      reason: "read-failed",
      status: "unavailable",
    });
  }
);

test("a servedAt that is not text is unreadable even when it prints as a valid time", async () => {
  const { reads } = scripted(pass());
  // The interface forbids this answer, so the read is replaced behind its type.
  Reflect.set(reads, "pullRequest", () =>
    Promise.resolve({ body: pr(), servedAt: { toString: () => READ } })
  );
  const result = await collectPullRequest(request(), reads);
  expect(result).toStrictEqual({
    path: "servedAt",
    reason: "served-at-unreadable",
    status: "unreadable",
  });
});

test("a read that rejects only in the second pass is unavailable", async () => {
  const { reads } = scripted(pass());
  let made = 0;
  const result = await collectPullRequest(request(), {
    ...reads,
    timeline: () => {
      made += 1;
      return made === 1
        ? Promise.resolve([])
        : Promise.reject(new Error(SECRET));
    },
  });
  expect(result).toStrictEqual({
    reason: "read-failed",
    status: "unavailable",
  });
});

test("a review history that cannot be decided is ambiguous", async () => {
  const result = await collect(
    pass({
      reviews: [
        reviewResponse({ id: 1 }),
        reviewResponse({ commit_id: OTHER, id: 2 }),
      ],
    })
  );
  expect(result).toStrictEqual({
    reason: "review-history-ambiguous",
    status: "ambiguous",
  });
});

test.each([
  { servedAt: "Thu, 01 Jan 2026 01:00:00 GMT" },
  { servedAt: "2026-01-01T01:00:00.000Z" },
  { servedAt: "2026-02-30T01:00:00Z" },
  { servedAt: "" },
])(
  "a pull request served at $servedAt is unreadable in either pass",
  async ({ servedAt }) => {
    const unreadable: PullRequestCollectionResult = {
      path: "servedAt",
      reason: "served-at-unreadable",
      status: "unreadable",
    };
    expect(await collect(pass({ servedAt }))).toStrictEqual(unreadable);
    expect(await collect(pass(), pass({ servedAt }))).toStrictEqual(unreadable);
  }
);

test("a second pull request read served earlier than the first is a stale response", async () => {
  const result = await collect(
    approvedPass(),
    approvedPass({ servedAt: "2026-01-01T00:59:59Z" }),
    { ledger: snapshot() }
  );
  expect(result).toStrictEqual({
    path: "servedAt",
    reason: "served-at-regressed",
    status: "unreadable",
  });
});

test("a second pull request read served in the same second as the first is accepted", async () => {
  const result = await collect(pass(), pass({ servedAt: READ }));
  expect(result.status).toBe("collected");
});

test("a review request the pull request no longer lists stays required while the timeline shows it", async () => {
  const result = collected(
    await collect(pass({ timeline: [reviewRequestedEvent()] }))
  );
  expect(result.evidence.assignments).toEqual({
    recorded: true,
    requiredReviewers: [REVIEWER],
  });
  expect(result.ledger.requiredReviewers).toEqual([
    { id: 7, kind: "user", login: "reviewer" },
  ]);
  expect(evaluate(result.evidence).gate("human-review").conclusion).toBe(
    "failure"
  );
});

test("an approval first seen with no earlier snapshot is unbound", async () => {
  const result = collected(await collect(approvedPass()));
  expect(result.evidence.humanReviews).toEqual([
    { reviewer: REVIEWER, state: "approved", subject: null },
  ]);
  expect(result.ledger.reviewBindings).toEqual({});
  expect(evaluate(result.evidence).gate("human-review").conclusion).toBe(
    "failure"
  );
});

test("a base change after the snapshot and before an approval leaves the approval unbound", async () => {
  const rebased = approvedPass({
    timeline: [
      reviewRequestedEvent(),
      { created_at: EARLY, event: "base_ref_changed" },
    ],
  });
  const result = collected(
    await collect(rebased, undefined, { ledger: snapshot() })
  );
  expect(result.evidence.humanReviews).toEqual([
    { reviewer: REVIEWER, state: "approved", subject: null },
  ]);
  expect(result.ledger.reviewBindings).toEqual({});
  expect(evaluate(result.evidence).gate("human-review").conclusion).toBe(
    "failure"
  );
});

test("a second collection binds an approval submitted after the first one's snapshot", async () => {
  const first = collected(
    await collect(pass({ servedAt: EARLY, timeline: [reviewRequestedEvent()] }))
  );
  expect(first.ledger.observedRevision).toEqual({
    baseSha: BASE,
    headSha: HEAD,
    observedAt: EARLY,
  });
  const second = collected(
    await collect(approvedPass(), undefined, { ledger: first.ledger })
  );
  expect(second.evidence.humanReviews).toEqual([
    { reviewer: REVIEWER, state: "approved", subject: subject(12) },
  ]);
  expect(evaluate(second.evidence).gate("human-review").conclusion).toBe(
    "success"
  );
});

test("the request's ledger is left as it was", async () => {
  const before = snapshot();
  const copy = structuredClone(before);
  const result = collected(
    await collect(approvedPass(), undefined, { ledger: before })
  );
  expect(before).toEqual(copy);
  expect(result.ledger).not.toBe(before);
  expect(Object.keys(result.ledger.reviewBindings)).toEqual(["900"]);
});

test("a request changed while the reads are awaited does not change what is collected", async () => {
  const changing = request({ ledger: snapshot() });
  const { reads } = scripted(approvedPass());
  const result = collected(
    await collectPullRequest(changing, {
      ...reads,
      timeline: () => {
        changing.ledger.observedRevision = null;
        changing.repository = "example/other";
        return reads.timeline();
      },
    })
  );
  expect(result.evidence.humanReviews).toEqual([
    { reviewer: REVIEWER, state: "approved", subject: subject(12) },
  ]);
});

test.each([{ holdLabel: 5 }, { holdLabel: [HOLD] }])(
  "a request whose hold label is not text, $holdLabel, is refused before anything is read",
  async ({ holdLabel }) => {
    const broken = request();
    // The type forbids this value, so it is set behind the type.
    Reflect.set(broken, "holdLabel", holdLabel);
    const fixture = scripted(pass());
    const result = await collectPullRequest(broken, fixture.reads);
    expect(result).toStrictEqual({
      reason: "request-malformed",
      status: "invalid-request",
    });
    expect(fixture.calls).toEqual([]);
  }
);

test.each<Partial<PullRequestCollectionRequest>>([
  { repository: "project" },
  { repository: "example/project/extra" },
  { repository: "" },
  { pullRequest: 0 },
  { pullRequest: 1.5 },
  { holdLabel: "" },
  { holdLabel: " forge:hold" },
  { holdLabel: "forge:hold " },
  { holdLabel: " " },
  { holdLabel: "forge\thold" },
  { holdLabel: "forge:hold\u007F" },
  { holdLabel: "straße" },
  { holdLabel: "café" },
  { provenance: { ...provenance("collector"), runtimeFingerprint: "1" } },
  { provenance: { ...provenance("collector"), runId: "" } },
  { maxThreadPages: 0 },
  { maxThreadPages: 1.5 },
  { maxThreadPages: Number.POSITIVE_INFINITY },
])("a request with %p is refused before anything is read", async (broken) => {
  const fixture = scripted(pass());
  const result = await collectPullRequest(request(broken), fixture.reads);
  expect(result).toStrictEqual({
    reason: "request-malformed",
    status: "invalid-request",
  });
  expect(fixture.calls).toEqual([]);
});
