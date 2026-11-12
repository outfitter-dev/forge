import { expect, test } from "bun:test";

import { GITHUB_GHOST_LOGIN } from "../src/github-pull-request-types.ts";
import {
  GitHubResponseError,
  parseBaseChanges,
  parsePullRequest,
  parseReviewRequests,
  parseReviews,
  parseReviewThreadPage,
} from "../src/parse-github-pull-request.ts";
import {
  actorResponse,
  BASE,
  ghostResponse,
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
    base: {
      ref: "main",
      repositoryId: 100,
      repositoryName: "example/project",
      sha: BASE,
    },
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

test("a null reviewer or team on a review request means that side is absent", () => {
  expect(
    parseReviewRequests([
      reviewRequestedEvent({
        requested_reviewer: null,
        requested_team: teamResponse(),
      }),
      reviewRequestedEvent({ requested_team: null }),
    ])
  ).toEqual([
    { kind: "team", team: { id: 31, slug: "maintainers" } },
    { kind: "user", reviewer: { id: 7, login: "reviewer", type: "User" } },
  ]);
});

test("a review request naming nobody is rejected even when both sides are null", () => {
  rejects(
    () =>
      parseReviewRequests([
        reviewRequestedEvent({
          requested_reviewer: null,
          requested_team: null,
        }),
      ]),
    "timeline[0]"
  );
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

const BASE_SIDE = {
  ref: "main",
  repo: { full_name: "example/project", id: 100 },
  sha: BASE,
};

// A field GitHub left out must stop collection. None of these may become a
// permissive default such as "not a draft" or "no reviewers requested".
test.each([
  { field: "draft", path: "pullRequest.draft" },
  { field: "merged", path: "pullRequest.merged" },
  { field: "labels", path: "pullRequest.labels" },
  { field: "requested_reviewers", path: "pullRequest.requested_reviewers" },
  { field: "requested_teams", path: "pullRequest.requested_teams" },
  { field: "user", path: "pullRequest.user" },
  { field: "number", path: "pullRequest.number" },
  { field: "state", path: "pullRequest.state" },
])("a pull request without $field is rejected", ({ field, path }) => {
  rejects(
    () => parsePullRequest(pullRequestResponse({ [field]: undefined })),
    path
  );
});

test.each([
  {
    name: "a head with no repository field",
    path: "pullRequest.head.repo",
    value: pullRequestResponse({ head: { ref: "feature", sha: HEAD } }),
  },
  {
    name: "requested teams sent as null",
    path: "pullRequest.requested_teams",
    value: pullRequestResponse({ requested_teams: null }),
  },
  {
    name: "a base repository with no name",
    path: "pullRequest.base.repo.full_name",
    value: pullRequestResponse({
      base: { ...BASE_SIDE, repo: { id: 100 } },
    }),
  },
  {
    name: "a commit ID one character too long",
    path: "pullRequest.base.sha",
    value: pullRequestResponse({ base: { ...BASE_SIDE, sha: `${BASE}b` } }),
  },
  {
    name: "a fractional pull request number",
    path: "pullRequest.number",
    value: pullRequestResponse({ number: 12.5 }),
  },
  {
    name: "an empty label name",
    path: "pullRequest.labels[0].name",
    value: pullRequestResponse({ labels: [{ id: 5, name: "" }] }),
  },
  {
    name: "an author with no account kind",
    path: "pullRequest.user.type",
    value: pullRequestResponse({ user: { id: 3, login: "author" } }),
  },
])("$name is rejected", ({ path, value }) => {
  rejects(() => parsePullRequest(value), path);
});

test.each([
  { state: "APPROVED", submitted_at: undefined },
  { state: "CHANGES_REQUESTED", submitted_at: null },
  { state: "DISMISSED", submitted_at: "not a time" },
  { state: "COMMENTED", submitted_at: "2026-01-01T00:10:00.500Z" },
  { state: "APPROVED", submitted_at: "2026-01-01T00:10:00+00:00" },
  { state: "APPROVED", submitted_at: "2026-02-30T00:10:00Z" },
  { state: "PENDING", submitted_at: "soon" },
])("a submitted review needs a whole-second UTC time %p", (review) => {
  rejects(
    () => parseReviews([reviewResponse(review)]),
    "reviews[0].submitted_at"
  );
});

test("a review with no author field is rejected", () => {
  rejects(
    () => parseReviews([reviewResponse({ user: undefined })]),
    "reviews[0].user"
  );
});

test("deleted accounts all parse as one identity", () => {
  const parsed = parseReviews([
    reviewResponse({ id: 1, user: ghostResponse() }),
    reviewResponse({
      id: 2,
      state: "CHANGES_REQUESTED",
      user: ghostResponse(),
    }),
  ]);
  expect(parsed.map((review) => review.author)).toEqual([
    { id: 10_137, login: GITHUB_GHOST_LOGIN, type: "User" },
    { id: 10_137, login: GITHUB_GHOST_LOGIN, type: "User" },
  ]);
});

test("events that can come with a base change are read with their time", () => {
  const names = [
    "base_ref_changed",
    "base_ref_force_pushed",
    "base_ref_deleted",
    "automatic_base_change_succeeded",
    "added_to_stack",
    "removed_from_stack",
  ];
  const timeline = [
    { created_at: "2026-01-01T00:01:00Z", event: "head_ref_force_pushed" },
    reviewRequestedEvent(),
    ...names.map((event) => ({ created_at: "2026-01-01T00:02:00Z", event })),
    { created_at: "2026-01-01T00:03:00Z", event: "labeled" },
  ];
  expect(parseBaseChanges(timeline)).toEqual(
    names.map((event) => ({ createdAt: "2026-01-01T00:02:00Z", event }))
  );
});

test.each([
  { path: "timeline", value: null },
  {
    path: "timeline[0].event",
    value: [{ created_at: "2026-01-01T00:02:00Z" }],
  },
  { path: "timeline[0].created_at", value: [{ event: "base_ref_changed" }] },
  {
    path: "timeline[0].created_at",
    value: [{ created_at: "yesterday", event: "base_ref_force_pushed" }],
  },
])("rejects base changes it cannot read at $path", ({ path, value }) => {
  rejects(() => parseBaseChanges(value), path);
});

test.each([
  {
    name: "no thread list",
    path: "threads.data.repository.pullRequest.reviewThreads.nodes",
    value: {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        },
      },
    },
  },
  {
    name: "a null thread",
    path: "threads.data.repository.pullRequest.reviewThreads.nodes[0]",
    value: {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [null],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        },
      },
    },
  },
  {
    name: "a null pull request without errors",
    path: "threads.data.repository.pullRequest",
    value: { data: { repository: { pullRequest: null } } },
  },
  {
    name: "a thread with no resolution flag",
    path: "threads.data.repository.pullRequest.reviewThreads.nodes[0].isResolved",
    value: threadPageResponse([undefined]),
  },
])(
  "a thread page with $name is rejected, never counted as resolved",
  ({ path, value }) => {
    rejects(() => parseReviewThreadPage(value), path);
  }
);

// `null` is not "no": each of these would otherwise read as a safe value.
test.each([
  { field: "draft", path: "pullRequest.draft" },
  { field: "merged", path: "pullRequest.merged" },
  { field: "labels", path: "pullRequest.labels" },
  { field: "requested_reviewers", path: "pullRequest.requested_reviewers" },
])("a pull request with a null $field is rejected", ({ field, path }) => {
  rejects(() => parsePullRequest(pullRequestResponse({ [field]: null })), path);
});

test("a null thread list is rejected, never read as no threads", () => {
  rejects(
    () =>
      parseReviewThreadPage({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: null,
                pageInfo: { endCursor: null, hasNextPage: false },
              },
            },
          },
        },
      }),
    "threads.data.repository.pullRequest.reviewThreads.nodes"
  );
});
