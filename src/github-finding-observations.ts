import type { PullRequestCommentReads } from "./collect-pull-request-types.ts";
import { readIssueComments } from "./github-issue-comments.ts";
import { GitHubReadError } from "./github-pull-request-reads.ts";
import type { GitHubActor } from "./github-pull-request-types.ts";
import {
  commit,
  each,
  fail,
  flag,
  graphQLActor,
  instant,
  record,
  text,
} from "./github-response.ts";

/** Optional authenticated reads used only by the configured finding-source policy. */
export interface PullRequestFindingReads {
  scopedReviewThreads: (cursor: string | null) => Promise<unknown>;
  scopedReviews: (cursor: string | null) => Promise<unknown>;
  scopedThreadComments?: (
    threadId: string,
    cursor: string | null
  ) => Promise<unknown>;
}

export interface FindingReport {
  id: string;
  nodeId: string;
  nativeRef: string;
  surface: "review" | "issue-comment" | "thread-comment";
  author: GitHubActor | null;
  editor: GitHubActor | null;
  body: string;
  updatedAt: string;
  lastEditedAt: string | null;
  commitId: string | null;
  state: string | null;
}

export interface FindingThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: FindingReport[];
}

export interface FindingObservation {
  threads: FindingThread[];
  reviews: FindingReport[];
  comments: FindingReport[];
}

const report = (
  value: unknown,
  path: string,
  surface: FindingReport["surface"]
): FindingReport => {
  const source = record(value, path);
  const revision =
    source.commit === null ? null : record(source.commit, `${path}.commit`);
  const nodeId = text(source.id, `${path}.id`);
  return {
    author: graphQLActor(source.author, `${path}.author`),
    body:
      typeof source.body === "string"
        ? source.body
        : fail(`${path}.body`, "a string"),
    commitId:
      revision === null ? null : commit(revision.oid, `${path}.commit.oid`),
    editor: graphQLActor(source.editor, `${path}.editor`),
    id: nodeId,
    lastEditedAt:
      source.lastEditedAt === null
        ? null
        : instant(source.lastEditedAt, `${path}.lastEditedAt`),
    nativeRef: text(source.url, `${path}.url`),
    nodeId,
    state: surface === "review" ? text(source.state, `${path}.state`) : null,
    surface,
    updatedAt: instant(source.updatedAt, `${path}.updatedAt`),
  };
};

const connection = (value: unknown, field: string) => {
  const source = record(value, field);
  if (source.errors !== undefined) {
    fail(`${field}.errors`, "no errors");
  }
  const data = record(source.data, `${field}.data`);
  const repository = record(data.repository, `${field}.data.repository`);
  const pullRequest = record(
    repository.pullRequest,
    `${field}.data.repository.pullRequest`
  );
  return record(pullRequest[field], `${field}.connection`);
};

const nextCursor = (value: unknown, path: string): string | null => {
  const info = record(value, path);
  return flag(info.hasNextPage, `${path}.hasNextPage`)
    ? text(info.endCursor, `${path}.endCursor`)
    : null;
};

const unique = <T extends { id: string }>(items: T[], path: string): T[] => {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      fail(path, "unique identities");
    }
    ids.add(item.id);
  }
  return items;
};

export const parseFindingThreadPage = (
  value: unknown
): {
  items: FindingThread[];
  nextCursor: string | null;
  pendingComments: { id: string; cursor: string }[];
} => {
  const source = connection(value, "reviewThreads");
  const pendingComments: { id: string; cursor: string }[] = [];
  const items = each(
    source.nodes,
    "reviewThreads.nodes",
    (item, path): FindingThread => {
      const thread = record(item, path);
      const comments = record(thread.comments, `${path}.comments`);
      const cursor = nextCursor(comments.pageInfo, `${path}.comments.pageInfo`);
      if (cursor !== null) {
        pendingComments.push({ cursor, id: text(thread.id, `${path}.id`) });
      }
      const reports = unique(
        each(comments.nodes, `${path}.comments.nodes`, (comment, itemPath) =>
          report(comment, itemPath, "thread-comment")
        ),
        `${path}.comments.nodes`
      );
      if (reports.length === 0) {
        fail(`${path}.comments.nodes`, "an original comment");
      }
      return {
        comments: reports,
        id: text(thread.id, `${path}.id`),
        isOutdated: flag(thread.isOutdated, `${path}.isOutdated`),
        isResolved: flag(thread.isResolved, `${path}.isResolved`),
      };
    }
  );
  return {
    items: unique(items, "reviewThreads.nodes"),
    nextCursor: nextCursor(source.pageInfo, "reviewThreads.pageInfo"),
    pendingComments,
  };
};

export const parseFindingReviewPage = (
  value: unknown
): { items: FindingReport[]; nextCursor: string | null } => {
  const source = connection(value, "reviews");
  return {
    items: unique(
      each(source.nodes, "reviews.nodes", (item, path) =>
        report(item, path, "review")
      ),
      "reviews.nodes"
    ),
    nextCursor: nextCursor(source.pageInfo, "reviews.pageInfo"),
  };
};

/** A node lookup may only extend the thread discovered in the authenticated PR connection. */
export const parseFindingThreadComments = (
  value: unknown,
  threadId: string
): { items: FindingReport[]; nextCursor: string | null } => {
  const source = record(value, "threadComments");
  if (source.errors !== undefined) {
    fail("threadComments.errors", "no errors");
  }
  const data = record(source.data, "threadComments.data");
  const node = record(data.node, "threadComments.data.node");
  if (node.id !== threadId) {
    fail("threadComments.data.node.id", "the requested thread identity");
  }
  const comments = record(node.comments, "threadComments.data.node.comments");
  return {
    items: unique(
      each(comments.nodes, "threadComments.nodes", (item, path) =>
        report(item, path, "thread-comment")
      ),
      "threadComments.nodes"
    ),
    nextCursor: nextCursor(comments.pageInfo, "threadComments.pageInfo"),
  };
};

const readPages = async <T extends { id: string }>(
  read: (cursor: string | null) => Promise<unknown>,
  parse: (value: unknown) => { items: T[]; nextCursor: string | null },
  maxPages: number,
  initialCursor: string | null = null
): Promise<T[]> => {
  const items: T[] = [];
  const cursors = new Set<string>(
    initialCursor === null ? [] : [initialCursor]
  );
  let cursor: string | null = initialCursor;
  for (let page = 0; page < maxPages; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- The next page is selected by the preceding response.
    const result = parse(await read(cursor));
    items.push(...result.items);
    unique(items, "findingSources.nodes");
    if (result.nextCursor === null) {
      return items;
    }
    if (cursors.has(result.nextCursor)) {
      fail("findingSources.pageInfo", "a new cursor");
    }
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new GitHubReadError("pages-exceeded");
};

/** Read complete current service observations. The caller brackets these with its revision snapshot and a second pass. */
export const readFindingObservation = async (
  reads: PullRequestFindingReads & PullRequestCommentReads,
  maxPages: number
): Promise<FindingObservation> => {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new GitHubReadError("options-invalid");
  }
  const pendingComments: { id: string; cursor: string }[] = [];
  const threads = await readPages(
    reads.scopedReviewThreads.bind(reads),
    (value) => {
      const parsed = parseFindingThreadPage(value);
      pendingComments.push(...parsed.pendingComments);
      return parsed;
    },
    maxPages
  );
  for (const pending of pendingComments) {
    const read = reads.scopedThreadComments;
    if (read === undefined) {
      throw new GitHubReadError("options-invalid");
    }
    // oxlint-disable-next-line no-await-in-loop -- Complete one bounded thread connection before observing the next.
    const comments = await readPages(
      (cursor) => read.call(reads, pending.id, cursor),
      (value) => parseFindingThreadComments(value, pending.id),
      maxPages - 1,
      pending.cursor
    );
    const thread =
      threads.find((item) => item.id === pending.id) ??
      fail("threadComments.id", "an observed thread");
    thread.comments.push(...comments);
  }
  const reviews = await readPages(
    reads.scopedReviews.bind(reads),
    parseFindingReviewPage,
    maxPages
  );
  const issueComments = await readIssueComments(reads, maxPages);
  const comments = issueComments.map((item): FindingReport => ({
    ...item,
    commitId: null,
    id: item.nodeId,
    state: null,
    surface: "issue-comment",
  }));
  unique(
    threads.flatMap((thread) => thread.comments),
    "reviewThreads.comments"
  );
  return { comments, reviews, threads };
};
