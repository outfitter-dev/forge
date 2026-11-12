import { GITHUB_REVIEW_STATES } from "./github-pull-request-types.ts";
import type {
  GitHubActor,
  GitHubPullRequest,
  GitHubReview,
  GitHubReviewRequest,
  GitHubReviewState,
  GitHubReviewThreadPage,
  GitHubTeam,
} from "./github-pull-request-types.ts";

/** Names the field and what was expected. Never carries response content. */
export class GitHubResponseError extends Error {
  readonly path: string;

  constructor(path: string, expectation: string) {
    super(`${path}: expected ${expectation}`);
    this.name = "GitHubResponseError";
    this.path = path;
  }
}

const fail = (path: string, expectation: string): never => {
  throw new GitHubResponseError(path, expectation);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown, path: string): Record<string, unknown> =>
  isRecord(value) ? value : fail(path, "an object");

const list = (value: unknown, path: string): unknown[] =>
  Array.isArray(value) ? value : fail(path, "an array");

const text = (value: unknown, path: string): string =>
  typeof value === "string" && value !== ""
    ? value
    : fail(path, "a nonempty string");

const flag = (value: unknown, path: string): boolean =>
  typeof value === "boolean" ? value : fail(path, "a boolean");

const identifier = (value: unknown, path: string): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fail(path, "a positive integer");

const commit = (value: unknown, path: string): string =>
  typeof value === "string" && /^[\da-f]{40}$/u.test(value)
    ? value
    : fail(path, "a full lowercase commit ID");

const actor = (value: unknown, path: string): GitHubActor => {
  const source = record(value, path);
  return {
    id: identifier(source.id, `${path}.id`),
    login: text(source.login, `${path}.login`),
    type: text(source.type, `${path}.type`),
  };
};

const team = (value: unknown, path: string): GitHubTeam => {
  const source = record(value, path);
  return {
    id: identifier(source.id, `${path}.id`),
    slug: text(source.slug, `${path}.slug`),
  };
};

const each = <T>(
  value: unknown,
  path: string,
  parse: (item: unknown, itemPath: string) => T
): T[] =>
  list(value, path).map((item, index) => parse(item, `${path}[${index}]`));

const revision = (value: unknown, path: string) => {
  const source = record(value, path);
  return {
    ref: text(source.ref, `${path}.ref`),
    repository: source.repo,
    sha: commit(source.sha, `${path}.sha`),
  };
};

const repositoryId = (value: unknown, path: string): number =>
  identifier(record(value, path).id, `${path}.id`);

const pullRequestState = (value: unknown, path: string): "open" | "closed" =>
  value === "open" || value === "closed" ? value : fail(path, "open or closed");

export const parsePullRequest = (value: unknown): GitHubPullRequest => {
  const path = "pullRequest";
  const source = record(value, path);
  const head = revision(source.head, `${path}.head`);
  const base = revision(source.base, `${path}.base`);
  return {
    author: actor(source.user, `${path}.user`),
    base: {
      ref: base.ref,
      repositoryId: repositoryId(base.repository, `${path}.base.repo`),
      sha: base.sha,
    },
    draft: flag(source.draft, `${path}.draft`),
    head: {
      ref: head.ref,
      repositoryId:
        head.repository === null
          ? null
          : repositoryId(head.repository, `${path}.head.repo`),
      sha: head.sha,
    },
    labels: each(source.labels, `${path}.labels`, (item, itemPath) => {
      const label = record(item, itemPath);
      return {
        id: identifier(label.id, `${itemPath}.id`),
        name: text(label.name, `${itemPath}.name`),
      };
    }),
    mergeable:
      source.mergeable === null
        ? null
        : flag(source.mergeable, `${path}.mergeable`),
    merged: flag(source.merged, `${path}.merged`),
    number: identifier(source.number, `${path}.number`),
    requestedReviewers: each(
      source.requested_reviewers,
      `${path}.requested_reviewers`,
      actor
    ),
    requestedTeams: each(
      source.requested_teams,
      `${path}.requested_teams`,
      team
    ),
    state: pullRequestState(source.state, `${path}.state`),
  };
};

/**
 * Every `review_requested` event in a pull request's timeline. An event that
 * names neither a person nor a team is rejected: the requirement it records
 * cannot be established.
 */
export const parseReviewRequests = (value: unknown): GitHubReviewRequest[] =>
  each(value, "timeline", (item, path): GitHubReviewRequest[] => {
    const event = record(item, path);
    if (text(event.event, `${path}.event`) !== "review_requested") {
      return [];
    }
    const requests: GitHubReviewRequest[] = [];
    if (event.requested_reviewer !== undefined) {
      requests.push({
        kind: "user",
        reviewer: actor(event.requested_reviewer, `${path}.requested_reviewer`),
      });
    }
    if (event.requested_team !== undefined) {
      requests.push({
        kind: "team",
        team: team(event.requested_team, `${path}.requested_team`),
      });
    }
    return requests.length > 0
      ? requests
      : fail(path, "a requested reviewer or team");
  }).flat();

const reviewState = (value: unknown, path: string): GitHubReviewState =>
  GITHUB_REVIEW_STATES.find((state) => state === value) ??
  fail(path, "a known review state");

export const parseReviews = (value: unknown): GitHubReview[] =>
  each(value, "reviews", (item, path) => {
    const review = record(item, path);
    return {
      author: actor(review.user, `${path}.user`),
      commitId:
        review.commit_id === null || review.commit_id === undefined
          ? null
          : commit(review.commit_id, `${path}.commit_id`),
      id: identifier(review.id, `${path}.id`),
      state: reviewState(review.state, `${path}.state`),
      submittedAt:
        review.submitted_at === null || review.submitted_at === undefined
          ? null
          : text(review.submitted_at, `${path}.submitted_at`),
    };
  });

/** One page of the GraphQL `reviewThreads` connection for a pull request. */
export const parseReviewThreadPage = (
  value: unknown
): GitHubReviewThreadPage => {
  const response = record(value, "threads");
  if (response.errors !== undefined) {
    fail("threads.errors", "no errors");
  }
  const data = record(response.data, "threads.data");
  const repository = record(data.repository, "threads.data.repository");
  const pullRequestPath = "threads.data.repository.pullRequest";
  const pullRequest = record(repository.pullRequest, pullRequestPath);
  const threadsPath = `${pullRequestPath}.reviewThreads`;
  const threads = record(pullRequest.reviewThreads, threadsPath);
  const resolved = each(threads.nodes, `${threadsPath}.nodes`, (item, path) =>
    flag(record(item, path).isResolved, `${path}.isResolved`)
  );
  const pageInfo = record(threads.pageInfo, `${threadsPath}.pageInfo`);
  const more = flag(
    pageInfo.hasNextPage,
    `${threadsPath}.pageInfo.hasNextPage`
  );
  return {
    nextCursor: more
      ? text(pageInfo.endCursor, `${threadsPath}.pageInfo.endCursor`)
      : null,
    unresolved: resolved.filter((isResolved) => !isResolved).length,
  };
};
