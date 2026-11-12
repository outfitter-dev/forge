import type { PullRequestCommentReads } from "./collect-pull-request-types.ts";
import { GitHubReadError } from "./github-pull-request-reads.ts";
import type {
  GitHubIssueComment,
  GitHubIssueCommentPage,
} from "./github-pull-request-types.ts";
import {
  each,
  fail,
  flag,
  graphQLActor,
  identifier,
  instant,
  record,
  text,
} from "./github-response.ts";

const comment = (value: unknown, path: string): GitHubIssueComment => {
  const source = record(value, path);
  return {
    author: graphQLActor(source.author, `${path}.author`),
    body:
      typeof source.body === "string"
        ? source.body
        : fail(`${path}.body`, "a string"),
    editor: graphQLActor(source.editor, `${path}.editor`),
    id: identifier(source.databaseId, `${path}.databaseId`),
    lastEditedAt:
      source.lastEditedAt === null
        ? null
        : instant(source.lastEditedAt, `${path}.lastEditedAt`),
    nativeRef: text(source.url, `${path}.url`),
    nodeId: text(source.id, `${path}.id`),
    updatedAt: instant(source.updatedAt, `${path}.updatedAt`),
  };
};

/** Shape validation of one complete comment connection page, with no source authentication. */
export const parseIssueCommentPage = (
  value: unknown
): GitHubIssueCommentPage => {
  const response = record(value, "comments");
  if (response.errors !== undefined) {
    fail("comments.errors", "no errors");
  }
  const data = record(response.data, "comments.data");
  const repository = record(data.repository, "comments.data.repository");
  const pullRequest = record(
    repository.pullRequest,
    "comments.data.repository.pullRequest"
  );
  const path = "comments.data.repository.pullRequest.comments";
  const connection = record(pullRequest.comments, path);
  const comments = each(connection.nodes, `${path}.nodes`, comment);
  const ids = new Set<number>();
  const nodeIds = new Set<string>();
  for (const [index, item] of comments.entries()) {
    if (ids.has(item.id) || nodeIds.has(item.nodeId)) {
      fail(`${path}.nodes[${index}]`, "unique comment identities");
    }
    ids.add(item.id);
    nodeIds.add(item.nodeId);
  }
  const info = record(connection.pageInfo, `${path}.pageInfo`);
  return {
    comments,
    nextCursor: flag(info.hasNextPage, `${path}.pageInfo.hasNextPage`)
      ? text(info.endCursor, `${path}.pageInfo.endCursor`)
      : null,
  };
};

/** Every comment in connection order. Incomplete pagination never returns a partial list. */
export const readIssueComments = async (
  reads: PullRequestCommentReads,
  maxPages: number
): Promise<GitHubIssueComment[]> => {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new GitHubReadError("options-invalid");
  }
  const comments: GitHubIssueComment[] = [];
  const ids = new Set<number>();
  const nodeIds = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let index = 0; index < maxPages; index += 1) {
    let response: unknown;
    try {
      // oxlint-disable-next-line no-await-in-loop -- Each page depends on the previous cursor.
      response = await reads.issueComments(cursor);
    } catch (error) {
      throw error instanceof GitHubReadError
        ? error
        : new GitHubReadError("request-failed");
    }
    const page = parseIssueCommentPage(response);
    for (const item of page.comments) {
      if (ids.has(item.id) || nodeIds.has(item.nodeId)) {
        fail(
          "comments.data.repository.pullRequest.comments.nodes",
          "unique comment identities across pages"
        );
      }
      ids.add(item.id);
      nodeIds.add(item.nodeId);
      comments.push(item);
    }
    if (page.nextCursor === null) {
      return comments;
    }
    if (cursors.has(page.nextCursor)) {
      fail(
        "comments.data.repository.pullRequest.comments.pageInfo.endCursor",
        "a new pagination cursor"
      );
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new GitHubReadError("pages-exceeded");
};
