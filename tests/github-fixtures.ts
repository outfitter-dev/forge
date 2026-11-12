/** Raw GitHub response shapes, trimmed to the fields Forge reads plus noise it must ignore. */

export const HEAD = "a".repeat(40);
export const BASE = "b".repeat(40);

export const actorResponse = (
  login = "reviewer",
  id = 7,
  type = "User"
): Record<string, unknown> => ({
  avatar_url: "https://example.invalid/avatar",
  id,
  login,
  type,
});

export const teamResponse = (
  slug = "maintainers",
  id = 31
): Record<string, unknown> => ({ id, name: "Maintainers", slug });

export const pullRequestResponse = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  base: {
    ref: "main",
    repo: { full_name: "example/project", id: 100, name: "project" },
    sha: BASE,
  },
  draft: false,
  head: { ref: "feature", repo: { id: 100, name: "project" }, sha: HEAD },
  labels: [{ color: "ededed", id: 5, name: "docs" }],
  mergeable: true,
  merged: false,
  number: 12,
  requested_reviewers: [actorResponse()],
  requested_teams: [teamResponse()],
  state: "open",
  title: "Ignored by the collector",
  user: actorResponse("author", 3),
  ...overrides,
});

export const reviewResponse = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  body: "Ignored by the collector",
  commit_id: HEAD,
  id: 900,
  state: "APPROVED",
  submitted_at: "2026-01-01T00:10:00Z",
  user: actorResponse(),
  ...overrides,
});

export const reviewRequestedEvent = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  actor: actorResponse("author", 3),
  event: "review_requested",
  id: 400,
  requested_reviewer: actorResponse(),
  ...overrides,
});

export const threadResponse = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  comments: {
    nodes: [
      { author: { __typename: "User", databaseId: 7, login: "reviewer" } },
    ],
  },
  id: "thread-0",
  isResolved: false,
  ...overrides,
});

export const threadPageResponse = (
  resolved: unknown[],
  pageInfo?: Record<string, unknown>,
  prefix = "thread"
): Record<string, unknown> => ({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: resolved.map((isResolved, index) =>
            threadResponse({ id: `${prefix}-${index}`, isResolved })
          ),
          pageInfo: pageInfo ?? { endCursor: null, hasNextPage: false },
        },
      },
    },
  },
});

/** How GitHub returns any deleted account, author or reviewer alike. */
export const ghostResponse = (): Record<string, unknown> =>
  actorResponse("ghost", 10_137);

export const issueCommentResponse = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  author: {
    __typename: "Bot",
    databaseId: 199_175_422,
    login: "review-bot[bot]",
  },
  body: "ordinary issue comment",
  databaseId: 500,
  editor: {
    __typename: "Bot",
    databaseId: 199_175_422,
    login: "review-bot[bot]",
  },
  id: "IC_500",
  lastEditedAt: "2026-01-01T00:10:00Z",
  updatedAt: "2026-01-01T00:10:00Z",
  url: "https://github.com/example/project/pull/12#issuecomment-500",
  ...overrides,
});

export const commentPageResponse = (
  nodes: unknown[],
  pageInfo?: Record<string, unknown>
): Record<string, unknown> => ({
  data: {
    repository: {
      pullRequest: {
        comments: {
          nodes,
          pageInfo: pageInfo ?? { endCursor: null, hasNextPage: false },
        },
      },
    },
  },
});
