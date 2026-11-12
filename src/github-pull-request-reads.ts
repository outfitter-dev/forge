import type {
  PullRequestCommentReads,
  PullRequestReads,
} from "./collect-pull-request-types.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

/** The only origin a request is ever made to. */
const ORIGIN = "https://api.github.com";

/** The REST API version the earlier pilot qualified live. */
const API_VERSION = "2026-03-10";

/**
 * Every value comes in as a variable; nothing is written into this text.
 * GraphQL reports no redirect for a renamed repository, so `followRenames:
 * false` asks GitHub to refuse an old name instead of answering for the new.
 */
const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name, followRenames: false) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes {
              author {
                __typename
                login
                ... on User { databaseId }
                ... on Bot { databaseId }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const COMMENTS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name, followRenames: false) {
    pullRequest(number: $number) {
      comments(first: 100, after: $cursor) {
        nodes {
          id databaseId url body updatedAt lastEditedAt
          author {
            __typename login
            ... on User { databaseId }
            ... on Bot { databaseId }
          }
          editor {
            __typename login
            ... on User { databaseId }
            ... on Bot { databaseId }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export interface GitHubPullRequestReadsOptions {
  /** `owner/name`. Every request is for this repository. */
  repository: string;
  /** The pull request number, a positive integer. */
  pullRequest: number;
  /** Sent only as the `Authorization` header. It needs read access and nothing more. */
  token: string;
  /** The global `fetch`, or a stand-in with its shape. Nothing else performs I/O. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The longest one request may take, in milliseconds. */
  timeoutMs: number;
  /** The most REST pages one list may span. A longer list fails; it is never cut short. */
  maxPages: number;
}

export type GitHubReadFailure =
  | "options-invalid"
  | "request-failed"
  | "timed-out"
  | "redirected"
  | "response-unreadable"
  | "date-header-unreadable"
  | "page-not-a-list"
  | "pages-exceeded";

/**
 * The one error this transport throws. Its message is the code, followed by
 * the HTTP status when a response came back with a failing one, such as
 * `request-failed 404`. It never holds the token, a URL, a response body or
 * header, or anything an underlying error said.
 */
export class GitHubReadError extends Error {
  readonly code: GitHubReadFailure;
  readonly status: number | null;

  constructor(code: GitHubReadFailure, status: number | null = null) {
    super(status === null ? code : `${code} ${status}`);
    this.name = "GitHubReadError";
    this.code = code;
    this.status = status;
  }
}

/** What an underlying error says may hold a token or a response, so it is dropped. */
const attempt = async <T>(
  work: () => Promise<T>,
  failure: () => GitHubReadError
): Promise<T> => {
  try {
    return await work();
  } catch {
    throw failure();
  }
};

const positiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

/** One URL path segment that a URL parser leaves as it is. */
const segment = (value: string): boolean =>
  /^[\w.-]+$/u.test(value) && value !== "." && value !== "..";

/** Visible ASCII only, so the header is sent exactly as given or not at all. */
const TOKEN = /^[!-~]+$/u;

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** The one form of HTTP date GitHub sends, such as `Thu, 12 Nov 2026 17:07:30 GMT`. */
const HTTP_DATE = new RegExp(
  `^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\\d{2}) (${MONTHS.join("|")}) (\\d{4}) (\\d{2}:\\d{2}:\\d{2}) GMT$`,
  "u"
);

/**
 * The response's `Date` header as a whole-second UTC time. No clock is read:
 * a header that is missing or in any other form fails. The day name is read
 * for its form and not checked against the date.
 */
const servedAt = (header: string | null): string => {
  const [, day = "", month = "", year = "", time = ""] =
    HTTP_DATE.exec(header ?? "") ?? [];
  const monthNumber = String(MONTHS.indexOf(month) + 1).padStart(2, "0");
  const instant = `${year}-${monthNumber}-${day}T${time}Z`;
  if (wholeSecondUtc(instant) === null) {
    throw new GitHubReadError("date-header-unreadable");
  }
  return instant;
};

/**
 * A `rel` that includes `next`, anywhere in the `Link` header. The target is
 * never read. A doubtful header counts as another page: asking for a page
 * that does not exist costs a request, and missing one that does loses items.
 * A header over the limit is doubtful unread: matching takes time that grows
 * with the square of its length, and no timeout can interrupt it.
 */
const NEXT = /\brel\s*=\s*"?[^",;]*\bnext\b/iu;
const LINK_LIMIT = 4096;
const anotherPage = (link: string | null): boolean =>
  link !== null && (link.length > LINK_LIMIT || NEXT.test(link));

/**
 * The pull-request reads and optional comment-page read, bound to one pull request of one
 * repository on `https://api.github.com`. It only reads, makes one request per
 * read step and never retries: a failure is a `GitHubReadError`.
 * @throws {GitHubReadError} `options-invalid`, before any request, when an option is not as described.
 */
export const githubPullRequestReads = (
  options: GitHubPullRequestReadsOptions
): PullRequestReads & PullRequestCommentReads => {
  // Taken once, so changing the caller's object later changes no request.
  // Types are checked too: a pattern reads a missing token as `undefined`.
  const {
    maxPages,
    pullRequest: pullNumber,
    repository: given,
    timeoutMs,
    token,
  } = options;
  const call = options.fetch;
  const fullName = typeof given === "string" ? given : "";
  const [owner = "", name = "", ...extra] = fullName.split("/");
  if (
    extra.length > 0 ||
    !segment(owner) ||
    !segment(name) ||
    !positiveInteger(pullNumber) ||
    typeof token !== "string" ||
    !TOKEN.test(token) ||
    typeof call !== "function" ||
    !positiveInteger(timeoutMs) ||
    !positiveInteger(maxPages)
  ) {
    throw new GitHubReadError("options-invalid");
  }
  const repository = `/repos/${owner}/${name}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Cache-Control": "no-cache",
    "User-Agent": "forge",
    "X-GitHub-Api-Version": API_VERSION,
  };

  /** One request to `path` on the fixed origin: a GET, or a POST of `body`. */
  const request = async (
    path: string,
    body?: string
  ): Promise<{ body: unknown; headers: Headers }> => {
    const signal = AbortSignal.timeout(timeoutMs);
    const failed = () =>
      new GitHubReadError(signal.aborted ? "timed-out" : "request-failed");
    const init =
      body === undefined
        ? { headers, method: "GET" }
        : {
            body,
            headers: { ...headers, "Content-Type": "application/json" },
            method: "POST",
          };
    const response = await attempt(
      () =>
        call(`${ORIGIN}${path}`, {
          ...init,
          cache: "no-store",
          // A renamed repository must not be read under another name.
          redirect: "error",
          signal,
        }),
      failed
    );
    if (response.redirected) {
      throw new GitHubReadError("redirected");
    }
    // GitHub answers each of these reads with 200. Another 2xx, such as a
    // proxy's 203 or a partial 206, is not the whole answer.
    if (response.status !== 200) {
      throw new GitHubReadError("request-failed", response.status);
    }
    const text = await attempt(() => response.text(), failed);
    try {
      const parsed: unknown = JSON.parse(text);
      return { body: parsed, headers: response.headers };
    } catch {
      throw new GitHubReadError("response-unreadable");
    }
  };

  /**
   * Every page of a REST list, in order. The next page's address is computed
   * here and never taken from the `Link` header, so no header can send a
   * request anywhere else.
   */
  const list = async (path: string): Promise<unknown[]> => {
    const pages: unknown[][] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Whether there is another page is known only from the page before it.
      const response = await request(`${path}?per_page=100&page=${page}`);
      if (!Array.isArray(response.body)) {
        throw new GitHubReadError("page-not-a-list");
      }
      pages.push(response.body);
      if (!anotherPage(response.headers.get("link"))) {
        return pages.flat();
      }
    }
    throw new GitHubReadError("pages-exceeded");
  };

  const graphQL = async (
    query: string,
    cursor: string | null
  ): Promise<unknown> => {
    const variables = { cursor, name, number: pullNumber, owner };
    const response = await request(
      "/graphql",
      JSON.stringify({ query, variables })
    );
    return response.body;
  };

  return {
    issueComments: (cursor) => graphQL(COMMENTS_QUERY, cursor),
    pullRequest: async () => {
      const response = await request(`${repository}/pulls/${pullNumber}`);
      return {
        body: response.body,
        servedAt: servedAt(response.headers.get("date")),
      };
    },
    reviewThreads: (cursor) => graphQL(THREADS_QUERY, cursor),
    reviews: () => list(`${repository}/pulls/${pullNumber}/reviews`),
    timeline: () => list(`${repository}/issues/${pullNumber}/timeline`),
  };
};
