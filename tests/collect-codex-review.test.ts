import { expect, test } from "bun:test";

import {
  collectPullRequest,
  emptyReviewLedgerEntry,
  GitHubReadError,
} from "../src/index.ts";
import type { PullRequestReads } from "../src/index.ts";
import {
  finding,
  HOSTED,
  localAttempt,
  nativeResolution,
} from "./agent-review-fixtures.ts";
import {
  collected,
  comment,
  config,
  pass,
  request,
  scripted,
  thread,
  threads,
} from "./codex-collection-fixtures.ts";
import { evaluate, READ, summary } from "./codex-review-fixtures.ts";
import { BASE, HEAD, subject } from "./evidence-fixtures.ts";
import { commentPageResponse } from "./github-fixtures.ts";

const ORDER = [
  "reviews",
  "comments:null",
  "pullRequest",
  "timeline",
  "threads:null",
  "pullRequest",
  "reviews",
  "timeline",
  "threads:null",
  "comments:null",
];
const sourceComment = (body: string) =>
  commentPageResponse([comment({ body })]);

test("optional Codex collection uses both complete passes and the real evaluator", async () => {
  const fixture = scripted();
  const result = collected(await collectPullRequest(request(), fixture.reads));
  expect(fixture.calls).toEqual(ORDER);
  expect(evaluate(result.codexReview)).toEqual({
    codes: [],
    conclusion: "success",
    eligible: true,
  });
  expect(result.ledger.reviewFindings).toEqual(
    result.codexReview?.reviewFindings
  );
  expect(result.ledger.reviewFindings.recorded).toBe(true);
  expect(result.evidence).not.toHaveProperty("agentReviews");
  expect(JSON.stringify(result.codexReview)).not.toContain(
    "private summary prose"
  );
});

test("disabled collection preserves four-read callers and exact success shape", async () => {
  const fixture = scripted();
  const given = request();
  delete given.codexReview;
  const four: PullRequestReads = {
    pullRequest: fixture.reads.pullRequest,
    reviewThreads: fixture.reads.reviewThreads,
    reviews: fixture.reads.reviews,
    timeline: fixture.reads.timeline,
  };
  const result = await collectPullRequest(given, four);
  expect(result.status).toBe("collected");
  expect(Object.keys(result).toSorted()).toEqual([
    "evidence",
    "ledger",
    "reviewThreads",
    "status",
  ]);
  expect(fixture.calls).toEqual(
    ORDER.filter((item) => !item.startsWith("comments"))
  );
  const unusedCapability = scripted();
  await collectPullRequest(given, unusedCapability.reads);
  expect(unusedCapability.calls).not.toContain("comments:null");
});

test("a configured missing comment capability fails before reads with no partial result", async () => {
  const fixture = scripted();
  const four: PullRequestReads = {
    pullRequest: fixture.reads.pullRequest,
    reviewThreads: fixture.reads.reviewThreads,
    reviews: fixture.reads.reviews,
    timeline: fixture.reads.timeline,
  };
  expect(await collectPullRequest(request(), four)).toEqual({
    reason: "comment-read-missing",
    status: "unavailable",
  });
  expect(fixture.calls).toEqual([]);
});

test.each(
  [
    null,
    undefined,
    {},
    { ...config(), maxCommentPages: 0 },
    { ...config(), maxCommentPages: 1.5 },
    { ...config(), botAccountId: 0 },
    { ...config(), findingsComplete: "true" },
    { ...config(), findingsComplete: undefined },
    { ...config(), attestation: undefined },
    {
      ...config(),
      issuer: { ...config().issuer, producer: "private-invalid-config" },
    },
    { ...config(), reviewer: { ...config().reviewer, rung: "local" } },
    { ...config(), reviewer: { ...config().reviewer, waitSeconds: 0 } },
  ].map((value) => ({ value }))
)(
  "malformed adopted configuration is a fixed invalid request before reads",
  async ({ value }) => {
    const given = request();
    Object.defineProperty(given, "codexReview", { enumerable: true, value });
    const fixture = scripted();
    expect(await collectPullRequest(given, fixture.reads)).toEqual({
      reason: "request-malformed",
      status: "invalid-request",
    });
    expect(fixture.calls).toEqual([]);
  }
);

test.each([
  { name: "body", overrides: { body: "changed" } },
  {
    name: "author",
    overrides: {
      author: { __typename: "Bot", databaseId: 99, login: "other" },
    },
  },
  {
    name: "editor",
    overrides: {
      editor: { __typename: "User", databaseId: 99, login: "human" },
    },
  },
  { name: "update time", overrides: { updatedAt: "2026-01-01T00:10:01Z" } },
  {
    name: "last edit time",
    overrides: { lastEditedAt: "2026-01-01T00:10:01Z" },
  },
  { name: "database ID", overrides: { databaseId: 501 } },
  { name: "node ID", overrides: { id: "IC_changed" } },
  {
    name: "native reference",
    overrides: {
      url: "https://github.com/example/project/pull/12#issuecomment-501",
    },
  },
])(
  "changing comment $name stops collection after the second full read",
  async ({ overrides }) => {
    const fixture = scripted(
      pass(),
      pass({ comments: [commentPageResponse([comment(overrides)])] })
    );
    const result = await collectPullRequest(request(), fixture.reads);
    expect(result).toEqual({ reason: "comments-changed", status: "changed" });
    expect(result).not.toHaveProperty("ledger");
    expect(fixture.calls).toEqual(ORDER);
  }
);

test("changing only the structured state block cannot retain stale clean evidence", async () => {
  const adverse = summary({ has_any_findings: true }).summary;
  if (adverse === null) {
    throw new Error("missing fixture summary");
  }
  const fixture = scripted(
    pass(),
    pass({ comments: [sourceComment(adverse.body)] })
  );
  expect(await collectPullRequest(request(), fixture.reads)).toEqual({
    reason: "comments-changed",
    status: "changed",
  });
});

test("full comment pagination is stable even when page boundaries differ", async () => {
  const extra = comment({ body: "unrelated", databaseId: 501, id: "IC_501" });
  const fixture = scripted(
    pass({
      comments: [
        commentPageResponse([comment()], {
          endCursor: "comment-1",
          hasNextPage: true,
        }),
        commentPageResponse([extra]),
      ],
    }),
    pass({ comments: [commentPageResponse([comment(), extra])] })
  );
  const result = collected(await collectPullRequest(request(), fixture.reads));
  expect(evaluate(result.codexReview)).toMatchObject({ eligible: true });
  expect(fixture.calls.filter((call) => call.startsWith("comments"))).toEqual([
    "comments:null",
    "comments:comment-1",
    "comments:null",
  ]);
});

test("comment bounds on either pass never return partial evidence or history", async () => {
  const long = pass({
    comments: [
      commentPageResponse([comment()], {
        endCursor: "comment-1",
        hasNextPage: true,
      }),
    ],
  });
  for (const fixture of [scripted(long), scripted(pass(), long)]) {
    // oxlint-disable-next-line no-await-in-loop -- Each independent fixture exercises an entire sequential collection.
    const result = await collectPullRequest(
      request({ codexReview: config({ maxCommentPages: 1 }) }),
      fixture.reads
    );
    expect(result).toEqual({
      reason: "comment-pages-exceeded",
      status: "unavailable",
    });
  }
});

test("duplicate comments across pages cannot be accepted as complete", async () => {
  const fixture = scripted(
    pass({
      comments: [
        commentPageResponse([comment()], {
          endCursor: "comment-1",
          hasNextPage: true,
        }),
        commentPageResponse([comment()]),
      ],
    })
  );
  const result = await collectPullRequest(request(), fixture.reads);
  expect(result).toMatchObject({
    reason: "response-unreadable",
    status: "unreadable",
  });
  expect(result).not.toHaveProperty("ledger");
});

test.each([
  { errors: [{ message: "private-source-error" }] },
  commentPageResponse([
    comment({ editor: { __typename: "Bot", login: "missing-numeric-ID" } }),
  ]),
  commentPageResponse([], { endCursor: null, hasNextPage: true }),
])(
  "malformed comment responses stay unreadable with fixed field paths",
  async (page) => {
    const result = await collectPullRequest(
      request(),
      scripted(pass({ comments: [page] })).reads
    );
    expect(result).toMatchObject({
      reason: "response-unreadable",
      status: "unreadable",
    });
    expect(JSON.stringify(result)).not.toContain("private-source-error");
  }
);

test.each([new Error("private-read-error"), new GitHubReadError("timed-out")])(
  "comment read errors never leak source content",
  async (failure) => {
    const fixture = scripted();
    fixture.reads.issueComments = () => {
      throw failure;
    };
    expect(await collectPullRequest(request(), fixture.reads)).toEqual({
      reason: "read-failed",
      status: "unavailable",
    });
  }
);

test("the first snapshot cannot bind an earlier clean report", async () => {
  const result = collected(
    await collectPullRequest(
      request({ ledger: emptyReviewLedgerEntry() }),
      scripted().reads
    )
  );
  expect(result.ledger.observedRevision?.observedAt).toBe(READ);
  expect(result.codexReview?.diagnostics).toContain("summary-unbound");
  expect(evaluate(result.codexReview).codes).toContain("review-unavailable");
});

test("base-away-and-back invalidates the original matching snapshot before normalization", async () => {
  const timeline = [
    { created_at: "2026-01-01T00:02:00Z", event: "base_ref_changed" },
    { created_at: "2026-01-01T00:03:00Z", event: "base_ref_changed" },
  ];
  const result = collected(
    await collectPullRequest(request(), scripted(pass({ timeline })).reads)
  );
  expect(result.ledger.observedRevision).toEqual({
    baseSha: BASE,
    headSha: HEAD,
    observedAt: READ,
  });
  expect(result.codexReview?.diagnostics).toContain("summary-unbound");
  expect(evaluate(result.codexReview).eligible).toBe(false);
});

test("the second servedAt cannot admit a summary newer than the first read", async () => {
  const fixture = scripted(
    pass({
      comments: [
        commentPageResponse([comment({ updatedAt: "2026-01-01T00:11:30Z" })]),
      ],
    }),
    pass({
      comments: [
        commentPageResponse([comment({ updatedAt: "2026-01-01T00:11:30Z" })]),
      ],
      servedAt: "2026-01-01T00:12:00Z",
    })
  );
  const result = collected(await collectPullRequest(request(), fixture.reads));
  expect(result.codexReview?.agentReviews[0].observedAt).toBe(READ);
  expect(evaluate(result.codexReview).codes).toContain("review-unavailable");
});

test("accepted adverse, reopened and disappeared findings reach returned atomic ledger and evaluator", async () => {
  const source = summary({
    has_any_findings: true,
    has_unresolved_findings: true,
  }).summary;
  if (source === null) {
    throw new Error("missing adverse fixture");
  }
  const first = collected(
    await collectPullRequest(
      request(),
      scripted(
        pass({
          comments: [sourceComment(source.body)],
          threads: threads(thread()),
        })
      ).reads
    )
  );
  expect(first.codexReview?.agentReviews[0].verdict).toBe("failed");
  expect(first.ledger.reviewFindings.findings[0]).toMatchObject({
    id: "T1",
    resolution: null,
  });
  const resolved = finding({
    id: "T1",
    resolution: nativeResolution(),
    reviewer: HOSTED,
  });
  const results = await Promise.all(
    [threads(thread()), threads()].map(async (visible) => {
      const given = request({
        ledger: {
          ...request().ledger,
          reviewFindings: { findings: [resolved], recorded: true },
        },
      });
      return collected(
        await collectPullRequest(
          given,
          scripted(pass({ threads: visible })).reads
        )
      );
    })
  );
  for (const result of results) {
    expect(result.ledger.reviewFindings.findings[0]?.resolution).toBeNull();
    expect(
      evaluate(result.codexReview, [localAttempt({ subject: subject(12) })])
        .codes
    ).toContain("blocking-findings");
  }
});

test("invalid effective source observations return fixed unreadable failure without evidence", async () => {
  const given = request({
    ledger: {
      ...request().ledger,
      observedRevision: {
        baseSha: BASE,
        headSha: HEAD,
        observedAt: "2026-01-01T01:00:00Z",
      },
    },
  });
  expect(await collectPullRequest(given, scripted().reads)).toEqual({
    path: "codexReview",
    reason: "codex-evidence-unreadable",
    status: "unreadable",
  });
});

test("a later bot update can bind the first persisted snapshot without restarting its observation window", async () => {
  const first = collected(
    await collectPullRequest(
      request({ ledger: emptyReviewLedgerEntry() }),
      scripted().reads
    )
  );
  const later = pass({
    comments: [
      commentPageResponse([comment({ updatedAt: "2026-01-01T00:12:00Z" })]),
    ],
    servedAt: "2026-01-01T00:13:00Z",
  });
  const result = collected(
    await collectPullRequest(
      request({ ledger: first.ledger }),
      scripted(later).reads
    )
  );
  expect(result.codexReview.agentReviews[0].startedAt).toBe(READ);
  expect(result.ledger.observedRevision).toEqual(first.ledger.observedRevision);
  expect(evaluate(result.codexReview).eligible).toBe(true);
});

test("request configuration and comment capability are captured before awaited reads", async () => {
  const given = request();
  const fixture = scripted();
  const { reviews } = fixture.reads;
  fixture.reads.reviews = () => {
    given.codexReview = config({ botAccountId: 99 });
    given.ledger.observedRevision = null;
    fixture.reads.issueComments = () => {
      throw new Error("swapped capability");
    };
    return reviews();
  };
  const result = collected(await collectPullRequest(given, fixture.reads));
  expect(result.codexReview.agentReviews[0].context).toBe("none");
  expect(evaluate(result.codexReview).eligible).toBe(true);
});

test.each([undefined, false])(
  "collection requires an explicit completeness claim rather than inferring it from reads",
  async (complete) => {
    const codexReview = config();
    if (complete === undefined) {
      delete codexReview.findingsComplete;
    } else {
      codexReview.findingsComplete = complete;
    }
    const result = collected(
      await collectPullRequest(request({ codexReview }), scripted().reads)
    );
    expect(result.ledger.reviewFindings.recorded).toBe(false);
    expect(evaluate(result.codexReview).codes).toContain("findings-unknown");
  }
);
