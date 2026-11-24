/* oxlint-disable require-await -- Async fixtures implement the transport contract without I/O. */
import { expect, test } from "bun:test";

import {
  readFindingObservation,
  parseFindingReviewPage,
} from "../src/github-finding-observations.ts";
import type { PullRequestFindingReads } from "../src/github-finding-observations.ts";
import { githubPullRequestReads } from "../src/github-pull-request-reads.ts";
import {
  commentPageResponse,
  issueCommentResponse,
} from "./github-fixtures.ts";

const actor = { __typename: "Bot", databaseId: 42, login: "renamed-bot" };
const report = (id = "R_1") => ({
  author: actor,
  body: "report",
  commit: { oid: "a".repeat(40) },
  editor: actor,
  id,
  lastEditedAt: null,
  state: "COMMENTED",
  updatedAt: "2026-11-24T00:00:00Z",
  url: `https://github.com/example/project/pull/12#${id}`,
});
const info = (endCursor: string | null = null) => ({
  endCursor,
  hasNextPage: endCursor !== null,
});
const page = (
  field: string,
  nodes: unknown[],
  endCursor: string | null = null
) => ({
  data: {
    repository: {
      pullRequest: { [field]: { nodes, pageInfo: info(endCursor) } },
    },
  },
});
const thread = (id = "T_1") => ({
  comments: { nodes: [report(`C_${id}`)], pageInfo: info() },
  id,
  isOutdated: true,
  isResolved: true,
});
const reads = (): PullRequestFindingReads & {
  issueComments: (cursor: string | null) => Promise<unknown>;
} => ({
  issueComments: async () => commentPageResponse([issueCommentResponse()]),
  scopedReviewThreads: async () => page("reviewThreads", [thread()]),
  scopedReviews: async () => page("reviews", [report()]),
});

test("finding observation retains historical review commits, outdated resolved threads, all comments and editor identities", async () => {
  const value = await readFindingObservation(reads(), 3);
  expect(value.threads[0]).toMatchObject({
    comments: [
      {
        author: { id: 42, type: "Bot" },
        commitId: "a".repeat(40),
        editor: { id: 42, type: "Bot" },
        surface: "thread-comment",
      },
    ],
    id: "T_1",
    isOutdated: true,
    isResolved: true,
  });
  expect(value.reviews[0]).toMatchObject({
    commitId: "a".repeat(40),
    id: "R_1",
    state: "COMMENTED",
    surface: "review",
  });
  expect(value.comments[0]).toMatchObject({
    commitId: null,
    state: null,
    surface: "issue-comment",
  });
});

test("every review page is read and changed editor metadata survives parsing", async () => {
  const cursors: (string | null)[] = [];
  const input = reads();
  input.scopedReviews = async (cursor: string | null) => {
    cursors.push(cursor);
    return cursor === null
      ? page("reviews", [report("R_1")], "next")
      : page("reviews", [
          {
            ...report("R_2"),
            editor: null,
            lastEditedAt: "2026-11-24T00:00:00Z",
          },
        ]);
  };
  const result = await readFindingObservation(input, 2);
  expect(cursors).toEqual([null, "next"]);
  expect(result.reviews[1]).toMatchObject({
    editor: null,
    lastEditedAt: "2026-11-24T00:00:00Z",
  });
});

test.each(["duplicate", "cursor", "bound"])(
  "incomplete or duplicate review pagination fails closed: %s",
  async (mode) => {
    const input = reads();
    input.scopedReviews = async (cursor: string | null) =>
      page(
        "reviews",
        [report(cursor === null || mode === "duplicate" ? "R_1" : "R_2")],
        mode === "cursor" ? "same" : "next"
      );
    await expect(
      readFindingObservation(input, mode === "bound" ? 1 : 3)
    ).rejects.toThrow();
  }
);

test("nested thread pages include every reply and preserve original thread state", async () => {
  const value = thread();
  value.comments.pageInfo = info("more");
  const input = reads();
  input.scopedReviewThreads = async () => page("reviewThreads", [value]);
  const calls: unknown[] = [];
  input.scopedThreadComments = async (id, cursor) => {
    calls.push([id, cursor]);
    return {
      data: {
        node: { comments: { nodes: [report("C_2")], pageInfo: info() }, id },
      },
    };
  };
  const result = await readFindingObservation(input, 2);
  expect(calls).toEqual([["T_1", "more"]]);
  expect(result.threads[0]?.comments.map((item) => item.id)).toEqual([
    "C_T_1",
    "C_2",
  ]);
  expect(result.threads[0]).toMatchObject({
    isOutdated: true,
    isResolved: true,
  });
});

test.each(["bound", "duplicate", "cursor", "identity", "missing"])(
  "nested thread pagination refuses incomplete evidence: %s",
  async (mode) => {
    const value = thread();
    value.comments.pageInfo = info("more");
    const input = reads();
    input.scopedReviewThreads = async () => page("reviewThreads", [value]);
    if (mode !== "missing") {
      input.scopedThreadComments = async (id) => ({
        data: {
          node: {
            comments: {
              nodes: [report(mode === "duplicate" ? "C_T_1" : "C_2")],
              pageInfo: info(mode === "cursor" ? "more" : null),
            },
            id: mode === "identity" ? "wrong" : id,
          },
        },
      });
    }
    await expect(
      readFindingObservation(input, mode === "bound" ? 1 : 3)
    ).rejects.toThrow();
  }
);

test.each([
  null,
  { __typename: "Mannequin", login: "migrated" },
  { __typename: "User", databaseId: 45, login: "ghost" },
])("missing or migrated author identity stays unknown", (author) => {
  expect(
    parseFindingReviewPage(page("reviews", [{ ...report(), author }])).items[0]
      ?.author
  ).toBeNull();
});

test("duplicate comment identities across different threads are rejected", async () => {
  const input = reads();
  input.scopedReviewThreads = async () =>
    page("reviewThreads", [
      thread("A"),
      { ...thread("B"), comments: thread("A").comments },
    ]);
  await expect(readFindingObservation(input, 3)).rejects.toThrow(
    "unique identities"
  );
});

test("transport exposes separate scoped queries with variables and complete nested-page detection", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const input = githubPullRequestReads({
    fetch: async (url, init) => {
      requests.push({ init, url });
      return Response.json({ data: {} });
    },
    maxPages: 3,
    pullRequest: 12,
    repository: "example/project",
    timeoutMs: 1000,
    token: "secret-test-value",
  });
  await input.scopedReviewThreads("cursor");
  await input.scopedReviews(null);
  await input.scopedThreadComments?.("T_1", "reply-cursor");
  const body = JSON.parse(String(requests[0]?.init.body));
  expect(body.variables).toEqual({
    cursor: "cursor",
    name: "project",
    number: 12,
    owner: "example",
  });
  expect(body.query).toContain("ForgeFindingThreads");
  expect(body.query).toContain("comments(first: 100)");
  expect(body.query).toContain("editor {");
  expect(body.query).toContain("isOutdated");
  expect(JSON.parse(String(requests[1]?.init.body)).query).toContain(
    "ForgeFindingReviews"
  );
  const nested = JSON.parse(String(requests[2]?.init.body));
  expect(nested.variables).toEqual({ cursor: "reply-cursor", threadId: "T_1" });
  expect(nested.query).toContain("ForgeFindingThreadComments");
  expect(nested.query).toContain("... on PullRequestReviewThread");
  expect(
    requests.every(
      (entry) =>
        entry.url === "https://api.github.com/graphql" &&
        entry.init.redirect === "error"
    )
  ).toBe(true);
});
