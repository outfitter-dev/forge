import { expect, test } from "bun:test";

import {
  GitHubResponseError,
  parsePullRequest,
  parseReviewRequests,
  parseReviews,
  parseReviewThreadPage,
} from "../src/parse-github-pull-request.ts";
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

const rejects = (parse: () => unknown, path: string) => {
  let caught: unknown = null;
  try {
    parse();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GitHubResponseError);
  if (caught instanceof GitHubResponseError) {
    expect(caught.path).toBe(path);
  }
};

test("reads the fields the collector decides on and ignores the rest", () => {
  expect(parsePullRequest(pullRequestResponse())).toEqual({
    author: { id: 3, login: "author", type: "User" },
    base: { ref: "main", repositoryId: 100, sha: BASE },
    draft: false,
    head: { ref: "feature", repositoryId: 100, sha: HEAD },
    labels: [{ id: 5, name: "docs" }],
    mergeable: true,
    merged: false,
    number: 12,
    requestedReviewers: [{ id: 7, login: "reviewer", type: "User" }],
    requestedTeams: [{ id: 31, slug: "maintainers" }],
    state: "open",
  });
});

test("mergeability GitHub has not computed stays unknown", () => {
  const parsed = parsePullRequest(pullRequestResponse({ mergeable: null }));
  expect(parsed.mergeable).toBeNull();
});

test("a head whose fork was deleted keeps its commit and loses its repository", () => {
  const parsed = parsePullRequest(
    pullRequestResponse({ head: { ref: "feature", repo: null, sha: HEAD } })
  );
  expect(parsed.head).toEqual({
    ref: "feature",
    repositoryId: null,
    sha: HEAD,
  });
});

test.each([
  { path: "pullRequest", value: null },
  { path: "pullRequest", value: [] },
  { path: "pullRequest.number", value: pullRequestResponse({ number: 0 }) },
  {
    path: "pullRequest.state",
    value: pullRequestResponse({ state: "merged" }),
  },
  { path: "pullRequest.draft", value: pullRequestResponse({ draft: "false" }) },
  { path: "pullRequest.merged", value: pullRequestResponse({ merged: 0 }) },
  {
    path: "pullRequest.mergeable",
    value: pullRequestResponse({ mergeable: undefined }),
  },
  { path: "pullRequest.user", value: pullRequestResponse({ user: null }) },
  {
    path: "pullRequest.user.id",
    value: pullRequestResponse({ user: actorResponse("author", -1) }),
  },
  {
    path: "pullRequest.head.sha",
    value: pullRequestResponse({
      head: { ref: "feature", repo: { id: 100 }, sha: HEAD.slice(0, 7) },
    }),
  },
  {
    path: "pullRequest.head.sha",
    value: pullRequestResponse({
      head: { ref: "feature", repo: { id: 100 }, sha: HEAD.toUpperCase() },
    }),
  },
  {
    path: "pullRequest.base.repo",
    value: pullRequestResponse({
      base: { ref: "main", repo: null, sha: BASE },
    }),
  },
  {
    path: "pullRequest.labels[0].name",
    value: pullRequestResponse({ labels: [{ id: 5 }] }),
  },
  {
    path: "pullRequest.requested_reviewers",
    value: pullRequestResponse({ requested_reviewers: null }),
  },
  {
    path: "pullRequest.requested_teams[0].slug",
    value: pullRequestResponse({ requested_teams: [{ id: 31 }] }),
  },
])("rejects a pull request it cannot read at $path", ({ path, value }) => {
  rejects(() => parsePullRequest(value), path);
});

test("an error names the field and never repeats what the response held", () => {
  const secret = "ghp_notARealTokenButShapedLikeOne000000000";
  let message = "";
  try {
    parsePullRequest(pullRequestResponse({ state: secret }));
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  expect(message).toContain("pullRequest.state");
  expect(message).not.toContain(secret);
});

test("review requests come from the timeline, for people and for teams", () => {
  const timeline = [
    { event: "committed", sha: HEAD },
    reviewRequestedEvent(),
    {
      actor: actorResponse("author", 3),
      event: "labeled",
      label: { name: "docs" },
    },
    reviewRequestedEvent({
      requested_reviewer: undefined,
      requested_team: teamResponse(),
    }),
    { event: "review_request_removed", requested_reviewer: actorResponse() },
  ];
  expect(parseReviewRequests(timeline)).toEqual([
    { kind: "user", reviewer: { id: 7, login: "reviewer", type: "User" } },
    { kind: "team", team: { id: 31, slug: "maintainers" } },
  ]);
});

test.each([
  { path: "timeline", value: { event: "review_requested" } },
  { path: "timeline[0]", value: ["review_requested"] },
  { path: "timeline[0].event", value: [{ id: 1 }] },
  {
    path: "timeline[0]",
    value: [reviewRequestedEvent({ requested_reviewer: undefined })],
  },
  {
    path: "timeline[0].requested_reviewer.login",
    value: [
      reviewRequestedEvent({ requested_reviewer: { id: 7, type: "User" } }),
    ],
  },
])("rejects a timeline it cannot read at $path", ({ path, value }) => {
  rejects(() => parseReviewRequests(value), path);
});

test("reviews keep their decision, commit and submission time", () => {
  const reviews = [
    reviewResponse(),
    reviewResponse({
      commit_id: null,
      id: 901,
      state: "PENDING",
      submitted_at: undefined,
    }),
  ];
  expect(parseReviews(reviews)).toEqual([
    {
      author: { id: 7, login: "reviewer", type: "User" },
      commitId: HEAD,
      id: 900,
      state: "APPROVED",
      submittedAt: "2026-01-01T00:10:00Z",
    },
    {
      author: { id: 7, login: "reviewer", type: "User" },
      commitId: null,
      id: 901,
      state: "PENDING",
      submittedAt: null,
    },
  ]);
});

test.each([
  { path: "reviews", value: null },
  { path: "reviews[0].state", value: [reviewResponse({ state: "approved" })] },
  { path: "reviews[0].user", value: [reviewResponse({ user: null })] },
  { path: "reviews[0].id", value: [reviewResponse({ id: "900" })] },
  {
    path: "reviews[0].commit_id",
    value: [reviewResponse({ commit_id: "abc" })],
  },
  {
    path: "reviews[0].submitted_at",
    value: [reviewResponse({ submitted_at: 5 })],
  },
])("rejects reviews it cannot read at $path", ({ path, value }) => {
  rejects(() => parseReviews(value), path);
});

test("a thread page counts everything not explicitly resolved", () => {
  expect(
    parseReviewThreadPage(threadPageResponse([true, false, false]))
  ).toEqual({
    nextCursor: null,
    unresolved: 2,
  });
  expect(
    parseReviewThreadPage(
      threadPageResponse([true], { endCursor: "cursor-2", hasNextPage: true })
    )
  ).toEqual({ nextCursor: "cursor-2", unresolved: 0 });
});

test.each([
  { path: "threads", value: null },
  {
    path: "threads.errors",
    value: { ...threadPageResponse([true]), errors: [{ message: "denied" }] },
  },
  {
    path: "threads.data.repository.pullRequest",
    value: { data: { repository: {} } },
  },
  {
    path: "threads.data.repository.pullRequest.reviewThreads.nodes[0].isResolved",
    value: threadPageResponse(["yes"]),
  },
  {
    path: "threads.data.repository.pullRequest.reviewThreads.pageInfo.endCursor",
    value: threadPageResponse([true], { endCursor: null, hasNextPage: true }),
  },
  {
    path: "threads.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage",
    value: threadPageResponse([true], { endCursor: null }),
  },
])("rejects a thread page it cannot read at $path", ({ path, value }) => {
  rejects(() => parseReviewThreadPage(value), path);
});
