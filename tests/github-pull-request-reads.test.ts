import { expect, test } from "bun:test";

import { GitHubReadError } from "../src/github-pull-request-reads.ts";
import { collectPullRequest, githubPullRequestReads } from "../src/index.ts";
import type {
  GitHubPullRequestReadsOptions,
  PullRequestReads,
} from "../src/index.ts";
import { at, provenance, REPOSITORY, subject } from "./evidence-fixtures.ts";
import {
  BASE,
  HEAD,
  pullRequestResponse,
  reviewRequestedEvent,
  reviewResponse,
  threadPageResponse,
} from "./github-fixtures.ts";

type Fetch = GitHubPullRequestReadsOptions["fetch"];

/** One request as the fake `fetch` received it. */
interface Recorded {
  body: string | null;
  cache: string | undefined;
  headers: Headers;
  method: string | undefined;
  redirect: string | undefined;
  signal: AbortSignal | null | undefined;
  url: string;
}

type Reply = (request: Recorded) => Response | Promise<Response>;

const API = "https://api.github.com";
const PULL = `${API}/repos/example/project/pulls/12`;
const GRAPHQL = `${API}/graphql`;
const reviewsPage = (page: number) =>
  `${PULL}/reviews?per_page=100&page=${page}`;
const timelinePage = (page: number) =>
  `${API}/repos/example/project/issues/12/timeline?per_page=100&page=${page}`;

/** Shaped like a credential, so a leak is easy to see. */
const TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
const BODY_MARKER = "BODY-MARKER-7f3a";
const HEADER_MARKER = "HEADER-MARKER-2c9e";
const UNDERLYING = "UNDERLYING-MARKER-51bd";
/** Years from any clock this test could run under. */
const SERVED = "Tue, 03 Mar 2020 04:05:06 GMT";
const SERVED_AT = "2020-03-03T04:05:06Z";

const record = (url: string, init: RequestInit): Recorded => ({
  body: typeof init.body === "string" ? init.body : null,
  cache: init.cache,
  headers: new Headers(init.headers),
  method: init.method,
  redirect: init.redirect,
  signal: init.signal,
  url,
});

/**
 * A `fetch` that records every request and answers the nth one with the nth
 * reply. A request past the script rejects, so it fails the read that made it.
 */
const fake = (...replies: Reply[]) => {
  const requests: Recorded[] = [];
  const fetch: Fetch = async (url, init) => {
    const request = record(url, init);
    requests.push(request);
    return await at(replies, requests.length - 1)(request);
  };
  return { fetch, requests };
};

/** A `fetch` that answers every request with the same reply. */
const always =
  (reply: Reply): Fetch =>
  async (url, init) =>
    await reply(record(url, init));

const json =
  (body: unknown, headers: Record<string, string> = {}, status = 200): Reply =>
  () =>
    Response.json(body, { headers: { Date: SERVED, ...headers }, status });

const raw =
  (body: string, headers: Record<string, string> = {}, status = 200): Reply =>
  () =>
    new Response(body, { headers: { Date: SERVED, ...headers }, status });

const nextLink = (url: string) => ({ Link: `<${url}>; rel="next"` });

const options = (
  fetch: Fetch,
  overrides: Partial<GitHubPullRequestReadsOptions> = {}
): GitHubPullRequestReadsOptions => ({
  fetch,
  maxPages: 5,
  pullRequest: 12,
  repository: REPOSITORY,
  timeoutMs: 60_000,
  token: TOKEN,
  ...overrides,
});

const urls = (requests: Recorded[]) => requests.map((request) => request.url);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The GraphQL request body: its query text and its variables. */
const graphql = (request: Recorded) => {
  const body: unknown = JSON.parse(request.body ?? "null");
  const { query, variables } = isRecord(body) ? body : {};
  if (!isRecord(body) || typeof query !== "string" || !isRecord(variables)) {
    throw new Error("not a GraphQL request body");
  }
  return { keys: Object.keys(body), query, variables };
};

const failure = async (work: () => Promise<unknown>) => {
  try {
    await work();
  } catch (error) {
    if (error instanceof GitHubReadError) {
      return error;
    }
    throw error;
  }
  throw new Error("the read did not fail");
};

const READS = [
  ["pullRequest", (reads: PullRequestReads) => reads.pullRequest()],
  ["timeline", (reads: PullRequestReads) => reads.timeline()],
  ["reviews", (reads: PullRequestReads) => reads.reviews()],
  ["reviewThreads", (reads: PullRequestReads) => reads.reviewThreads(null)],
] as const;

test("pullRequest() GETs the pull request and returns its body with the response's Date as servedAt", async () => {
  const { fetch, requests } = fake(json(pullRequestResponse()));
  const result = await githubPullRequestReads(options(fetch)).pullRequest();
  expect(result).toStrictEqual({
    body: pullRequestResponse(),
    servedAt: SERVED_AT,
  });
  expect(requests).toHaveLength(1);
  expect(at(requests)).toMatchObject({ body: null, method: "GET", url: PULL });
});

test("timeline() GETs the first page of the issue timeline", async () => {
  const { fetch, requests } = fake(json([reviewRequestedEvent()]));
  const result = await githubPullRequestReads(options(fetch)).timeline();
  expect(result).toStrictEqual([reviewRequestedEvent()]);
  expect(requests).toHaveLength(1);
  expect(at(requests)).toMatchObject({
    body: null,
    method: "GET",
    url: timelinePage(1),
  });
});

test("reviews() GETs the first page of the pull request's reviews", async () => {
  const { fetch, requests } = fake(json([reviewResponse()]));
  const result = await githubPullRequestReads(options(fetch)).reviews();
  expect(result).toStrictEqual([reviewResponse()]);
  expect(requests).toHaveLength(1);
  expect(at(requests)).toMatchObject({
    body: null,
    method: "GET",
    url: reviewsPage(1),
  });
});

test("reviewThreads() POSTs the thread query with the repository, number and cursor as variables", async () => {
  const { fetch, requests } = fake(json(threadPageResponse([true, false])));
  const reads = githubPullRequestReads(options(fetch));
  expect(await reads.reviewThreads(null)).toStrictEqual(
    threadPageResponse([true, false])
  );
  expect(requests).toHaveLength(1);
  expect(at(requests)).toMatchObject({ method: "POST", url: GRAPHQL });
  const sent = graphql(at(requests));
  expect(sent.keys.toSorted()).toStrictEqual(["query", "variables"]);
  expect(sent.variables).toStrictEqual({
    cursor: null,
    name: "project",
    number: 12,
    owner: "example",
  });
  for (const part of [
    "$owner: String!",
    "$name: String!",
    "$number: Int!",
    "$cursor: String",
    "repository(owner: $owner, name: $name)",
    "pullRequest(number: $number)",
    "reviewThreads(first: 100, after: $cursor)",
    "nodes { isResolved }",
    "pageInfo { hasNextPage endCursor }",
  ]) {
    expect(sent.query).toContain(part);
  }
});

test("the thread query text is the same for every repository, number and cursor", async () => {
  const hostile = '") { viewer { login } } #';
  const first = fake(json(threadPageResponse([])));
  const second = fake(json(threadPageResponse([])));
  await githubPullRequestReads(options(first.fetch)).reviewThreads(null);
  await githubPullRequestReads(
    options(second.fetch, { pullRequest: 7341, repository: "Other-Org/a.b_c" })
  ).reviewThreads(hostile);
  const sent = graphql(at(second.requests));
  expect(sent.query).toBe(graphql(at(first.requests)).query);
  expect(sent.variables).toStrictEqual({
    cursor: hostile,
    name: "a.b_c",
    number: 7341,
    owner: "Other-Org",
  });
  for (const value of ["Other-Org", "a.b_c", "7341", "viewer"]) {
    expect(sent.query).not.toContain(value);
  }
  expect(urls(second.requests)).toStrictEqual([GRAPHQL]);
});

test("reviewThreads() returns the response body as it is, errors included", async () => {
  const body = { data: null, errors: [{ message: "Could not resolve" }] };
  const { fetch } = fake(json(body));
  const reads = githubPullRequestReads(options(fetch));
  expect(await reads.reviewThreads("cursor-1")).toStrictEqual(body);
});

test("every request goes to api.github.com for the configured repository and number, with the required headers and no redirects", async () => {
  const { fetch, requests } = fake(
    json(pullRequestResponse()),
    json([], nextLink(timelinePage(2))),
    json([]),
    json([], nextLink(reviewsPage(2))),
    json([]),
    json(threadPageResponse([]))
  );
  const reads = githubPullRequestReads(
    options(fetch, { pullRequest: 7341, repository: "Other-Org/a.b_c" })
  );
  await reads.pullRequest();
  await reads.timeline();
  await reads.reviews();
  await reads.reviewThreads("cursor-1");
  const rest = `${API}/repos/Other-Org/a.b_c`;
  expect(urls(requests)).toStrictEqual([
    `${rest}/pulls/7341`,
    `${rest}/issues/7341/timeline?per_page=100&page=1`,
    `${rest}/issues/7341/timeline?per_page=100&page=2`,
    `${rest}/pulls/7341/reviews?per_page=100&page=1`,
    `${rest}/pulls/7341/reviews?per_page=100&page=2`,
    GRAPHQL,
  ]);
  for (const request of requests) {
    const post = request.method === "POST";
    expect(request.url.startsWith(`${API}/`)).toBe(true);
    expect(new URL(request.url).origin).toBe(API);
    expect(request.redirect).toBe("error");
    expect(request.cache).toBe("no-store");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(request.headers)).toStrictEqual({
      accept: "application/vnd.github+json",
      authorization: `Bearer ${TOKEN}`,
      "cache-control": "no-cache",
      ...(post ? { "content-type": "application/json" } : {}),
      "user-agent": "forge",
      "x-github-api-version": "2026-03-10",
    });
  }
});

test("the token appears only in the Authorization header and never in a URL, a request body or a returned value", async () => {
  const { fetch, requests } = fake(
    json(pullRequestResponse()),
    json([]),
    json([]),
    json(threadPageResponse([]))
  );
  const reads = githubPullRequestReads(options(fetch));
  const returned = [
    await reads.pullRequest(),
    await reads.timeline(),
    await reads.reviews(),
    await reads.reviewThreads(null),
  ];
  expect(JSON.stringify(returned)).not.toContain(TOKEN);
  for (const request of requests) {
    expect(request.url).not.toContain(TOKEN);
    expect(request.body ?? "").not.toContain(TOKEN);
    const carriers = [...request.headers]
      .filter(([, value]) => value.includes(TOKEN))
      .map(([name]) => name);
    expect(carriers).toStrictEqual(["authorization"]);
  }
});

test.each([
  ["Thu, 12 Nov 2026 17:07:30 GMT", "2026-11-12T17:07:30Z"],
  // The day name is read for its form and not checked against the date.
  ["Wed, 12 Nov 2026 17:07:30 GMT", "2026-11-12T17:07:30Z"],
  ["Sat, 01 Jan 2000 00:00:00 GMT", "2000-01-01T00:00:00Z"],
  ["Thu, 29 Feb 2024 23:59:59 GMT", "2024-02-29T23:59:59Z"],
  ["Fri, 31 Dec 2032 12:00:01 GMT", "2032-12-31T12:00:01Z"],
])("a Date header of %p gives servedAt %p", async (header, servedAt) => {
  const { fetch } = fake(json(pullRequestResponse(), { Date: header }));
  const result = await githubPullRequestReads(options(fetch)).pullRequest();
  expect(result.servedAt).toBe(servedAt);
});

test("servedAt is each response's own Date header, not a clock and not an earlier response's", async () => {
  const { fetch } = fake(
    json(pullRequestResponse(), { Date: "Sat, 01 Jan 2000 00:00:00 GMT" }),
    json(pullRequestResponse(), { Date: "Fri, 31 Dec 2032 12:00:01 GMT" })
  );
  const reads = githubPullRequestReads(options(fetch));
  const year = new Date().getUTCFullYear();
  const first = await reads.pullRequest();
  const second = await reads.pullRequest();
  expect(first.servedAt).toBe("2000-01-01T00:00:00Z");
  expect(second.servedAt).toBe("2032-12-31T12:00:01Z");
  expect(first.servedAt.startsWith(String(year))).toBe(false);
  expect(second.servedAt.startsWith(String(year))).toBe(false);
});

test.each([
  "",
  "   ",
  "not a date",
  "2026-11-12T17:07:30Z",
  "1794503250",
  "Thu, 12 Nov 2026 17:07:30",
  "Thu, 12 Nov 2026 17:07:30 UTC",
  "Thu, 12 Nov 2026 17:07:30 PST",
  "Thu, 12 Nov 2026 17:07:30 +0100",
  "Thu, 12 Nov 2026 17:07:30.500 GMT",
  "Thu, 12 Nov 2026 17:07 GMT",
  "Thu, 12 Nov 2026 24:00:00 GMT",
  "Thu, 12 Nov 2026 17:07:60 GMT",
  "Mon, 30 Feb 2026 00:00:00 GMT",
  "Thu, 12 Foo 2026 17:07:30 GMT",
  "Thu, 2 Nov 2026 17:07:30 GMT",
  "thu, 12 nov 2026 17:07:30 gmt",
  "12 Nov 2026 17:07:30 GMT",
  "Thursday, 12-Nov-26 17:07:30 GMT",
  "Thu Nov 12 17:07:30 2026",
  "Thu, 12 Nov 2026 17:07:30 GMT, Thu, 12 Nov 2026 17:07:31 GMT",
])("a Date header of %p fails the pull request read", async (header) => {
  const { fetch } = fake(json(pullRequestResponse(), { Date: header }));
  const error = await failure(() =>
    githubPullRequestReads(options(fetch)).pullRequest()
  );
  expect(error.message).toBe("date-header-unreadable");
});

test("a pull request response with no Date header fails", async () => {
  const { fetch } = fake(() => Response.json(pullRequestResponse()));
  const error = await failure(() =>
    githubPullRequestReads(options(fetch)).pullRequest()
  );
  expect(error.message).toBe("date-header-unreadable");
});

test("three pages are joined in order and the list stops at the page with no next link", async () => {
  const { fetch, requests } = fake(
    json([{ id: 1 }, { id: 2 }], nextLink(reviewsPage(2))),
    json([{ id: 3 }], nextLink(reviewsPage(3))),
    json([{ id: 4 }, { id: 5 }])
  );
  const result = await githubPullRequestReads(options(fetch)).reviews();
  expect(result).toStrictEqual([
    { id: 1 },
    { id: 2 },
    { id: 3 },
    { id: 4 },
    { id: 5 },
  ]);
  expect(urls(requests)).toStrictEqual([
    reviewsPage(1),
    reviewsPage(2),
    reviewsPage(3),
  ]);
});

test("the timeline is paged the same way", async () => {
  const { fetch, requests } = fake(
    json([{ event: "labeled" }], nextLink(timelinePage(2))),
    json([{ event: "closed" }])
  );
  const result = await githubPullRequestReads(options(fetch)).timeline();
  expect(result).toStrictEqual([{ event: "labeled" }, { event: "closed" }]);
  expect(urls(requests)).toStrictEqual([timelinePage(1), timelinePage(2)]);
});

test.each([
  "https://evil.example/repos/example/project/pulls/12/reviews?per_page=100&page=2",
  `${API}/repos/other/repository/pulls/99/reviews?per_page=100&page=2`,
  `${API}/user/emails?page=7`,
  `http://api.github.com/repos/example/project/pulls/12/reviews?page=9`,
  "//evil.example/x",
  "",
])(
  "a next link to %p only causes a request for the computed next page",
  async (target) => {
    const { fetch, requests } = fake(
      json([{ id: 1 }], nextLink(target)),
      json([{ id: 2 }])
    );
    const result = await githubPullRequestReads(options(fetch)).reviews();
    expect(result).toStrictEqual([{ id: 1 }, { id: 2 }]);
    expect(urls(requests)).toStrictEqual([reviewsPage(1), reviewsPage(2)]);
  }
);

test.each([
  `<${reviewsPage(1)}>; rel="prev"`,
  `<${reviewsPage(1)}>; rel="prev", <${reviewsPage(1)}>; rel="first"`,
  `<${reviewsPage(9)}>; rel="last"`,
  `<${reviewsPage(2)}>; rel="nextish"`,
  `<${API}/repos/vercel/next.js/pulls/12/reviews?page=1>; rel="prev"`,
  "",
])("a Link header of %p ends the list", async (link) => {
  const { fetch, requests } = fake(json([{ id: 1 }], { Link: link }));
  const result = await githubPullRequestReads(options(fetch)).reviews();
  expect(result).toStrictEqual([{ id: 1 }]);
  expect(urls(requests)).toStrictEqual([reviewsPage(1)]);
});

test.each([
  `<${reviewsPage(1)}>; rel="prev", <${reviewsPage(3)}>; rel="next", <${reviewsPage(9)}>; rel="last"`,
  `<${reviewsPage(2)}>; rel=next`,
  `<${reviewsPage(2)}>; REL="NEXT"`,
  `<${reviewsPage(2)}>;rel = "next"`,
  `<${reviewsPage(2)}>; rel="last next"`,
  `<${reviewsPage(2)}>; title="more"; rel="next"`,
  // A doubtful header is read as another page, never as the end of the list.
  `<${reviewsPage(2)}; rel="next", <${reviewsPage(9)}>; rel="last"`,
  `<${API}/x?rel=next>; rel="last"`,
])("a Link header of %p means another page", async (link) => {
  const { fetch, requests } = fake(
    json([{ id: 1 }], { Link: link }),
    json([{ id: 2 }])
  );
  const result = await githubPullRequestReads(options(fetch)).reviews();
  expect(result).toStrictEqual([{ id: 1 }, { id: 2 }]);
  expect(urls(requests)).toStrictEqual([reviewsPage(1), reviewsPage(2)]);
});

test.each([1, 2, 3])(
  "a next link on page %p when maxPages is that many fails instead of returning a partial list",
  async (maxPages) => {
    const { fetch, requests } = fake(
      json([{ id: 1 }], nextLink(reviewsPage(2))),
      json([{ id: 2 }], nextLink(reviewsPage(3))),
      json([{ id: 3 }], nextLink(reviewsPage(4))),
      json([{ id: 4 }])
    );
    const error = await failure(() =>
      githubPullRequestReads(options(fetch, { maxPages })).reviews()
    );
    expect(error.message).toBe("pages-exceeded");
    expect(requests).toHaveLength(maxPages);
  }
);

test("a list that ends on exactly the last allowed page is returned whole", async () => {
  const { fetch, requests } = fake(
    json([{ id: 1 }], nextLink(timelinePage(2))),
    json([{ id: 2 }])
  );
  const result = await githubPullRequestReads(
    options(fetch, { maxPages: 2 })
  ).timeline();
  expect(result).toStrictEqual([{ id: 1 }, { id: 2 }]);
  expect(requests).toHaveLength(2);
});

test.each([
  { message: "Not Found" },
  { 0: "first", length: 1 },
  null,
  "[]",
  7,
  true,
])("a list page that is %p and not an array fails", async (body) => {
  const first = fake(json(body));
  const later = fake(json([{ id: 1 }], nextLink(timelinePage(2))), json(body));
  const reads = [
    () => githubPullRequestReads(options(first.fetch)).reviews(),
    () => githubPullRequestReads(options(later.fetch)).timeline(),
  ];
  for (const read of reads) {
    // oxlint-disable-next-line no-await-in-loop -- Each read is checked in turn.
    const error = await failure(read);
    expect(error.message).toBe("page-not-a-list");
  }
});

/** GitHub answers each of these reads with 200, so nothing else is a success. */
const statuses = [
  401, 403, 404, 429, 500, 502, 301, 302, 304, 307, 308, 201, 202, 203, 204,
  206,
];

test.each(
  READS.flatMap(([name, read]) =>
    statuses.map((status) => [name, status, read] as const)
  )
)(
  "%s() fails on status %p and makes no further request",
  async (_name, status, read) => {
    // A 204 and a 304 cannot be built with a body.
    const empty = status === 204 || status === 304;
    const { fetch, requests } = fake(
      () =>
        new Response(empty ? null : JSON.stringify([BODY_MARKER]), {
          headers: {
            Date: SERVED,
            Link: `<${reviewsPage(2)}>; rel="next"`,
            Location: `${API}/repositories/100/pulls/12`,
          },
          status,
        })
    );
    const error = await failure(() =>
      read(githubPullRequestReads(options(fetch)))
    );
    expect(error.message).toBe(`request-failed ${status}`);
    expect(error.status).toBe(status);
    expect(requests).toHaveLength(1);
  }
);

test.each(READS)(
  "%s() fails on a response that followed a redirect",
  async (_name, read) => {
    const { fetch, requests } = fake(() => {
      const response = Response.json(pullRequestResponse(), {
        headers: { Date: SERVED },
      });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    });
    const error = await failure(() =>
      read(githubPullRequestReads(options(fetch)))
    );
    expect(error.message).toBe("redirected");
    expect(requests).toHaveLength(1);
  }
);

test.each(READS)(
  "%s() fails when fetch rejects or throws",
  async (_name, read) => {
    const rejecting = fake(() => Promise.reject(new Error(UNDERLYING)));
    const throwing = fake(() => {
      throw new TypeError(UNDERLYING);
    });
    for (const { fetch, requests } of [rejecting, throwing]) {
      // oxlint-disable-next-line no-await-in-loop -- Each fetch is checked in turn.
      const error = await failure(() =>
        read(githubPullRequestReads(options(fetch)))
      );
      expect(error.message).toBe("request-failed");
      expect(error.status).toBeNull();
      expect(requests).toHaveLength(1);
    }
  }
);

/** Answers only when the request's signal aborts, as a stalled connection would. */
const stalled: Reply = (request) => {
  const { promise, reject } = Promise.withResolvers<Response>();
  if (!request.signal) {
    throw new Error("no signal");
  }
  request.signal.addEventListener("abort", () => reject(new Error(UNDERLYING)));
  return promise;
};

test.each(READS)(
  "%s() fails as timed-out when a request outlasts timeoutMs",
  async (_name, read) => {
    const { fetch, requests } = fake(stalled);
    const error = await failure(() =>
      read(githubPullRequestReads(options(fetch, { timeoutMs: 5 })))
    );
    expect(error.message).toBe("timed-out");
    expect(requests).toHaveLength(1);
  }
);

test("a body that stalls past timeoutMs fails as timed-out", async () => {
  const { fetch } = fake((request) => {
    const response = Response.json([], { headers: { Date: SERVED } });
    Object.defineProperty(response, "text", { value: () => stalled(request) });
    return response;
  });
  const error = await failure(() =>
    githubPullRequestReads(options(fetch, { timeoutMs: 5 })).reviews()
  );
  expect(error.message).toBe("timed-out");
});

test("each request has its own timeout signal, not yet aborted", async () => {
  const { fetch, requests } = fake(
    json([], nextLink(reviewsPage(2))),
    json([], nextLink(reviewsPage(3))),
    json([])
  );
  const aborted: boolean[] = [];
  const watching: Fetch = (url, init) => {
    aborted.push(init.signal?.aborted ?? true);
    return fetch(url, init);
  };
  await githubPullRequestReads(options(watching)).reviews();
  expect(aborted).toStrictEqual([false, false, false]);
  expect(new Set(requests.map((request) => request.signal)).size).toBe(3);
});

test.each(READS)(
  "%s() fails on a body that is not JSON",
  async (_name, read) => {
    for (const body of ["", `<html>${BODY_MARKER}</html>`, `[{"id": 1},`]) {
      const { fetch } = fake(raw(body));
      // oxlint-disable-next-line no-await-in-loop -- Each body is checked in turn.
      const error = await failure(() =>
        read(githubPullRequestReads(options(fetch)))
      );
      expect(error.message).toBe("response-unreadable");
    }
  }
);

test("a body that cannot be read fails as a failed request", async () => {
  const { fetch } = fake(() => {
    const response = Response.json([], { headers: { Date: SERVED } });
    Object.defineProperty(response, "text", {
      value: () => Promise.reject(new Error(UNDERLYING)),
    });
    return response;
  });
  const error = await failure(() =>
    githubPullRequestReads(options(fetch)).reviews()
  );
  expect(error.message).toBe("request-failed");
});

/** Every failure this transport has, each answered with secrets it must not repeat. */
const leaky: [string, string, (reads: PullRequestReads) => Promise<unknown>][] =
  [
    ["request-failed 401", "status", (reads) => reads.pullRequest()],
    ["request-failed 500", "status", (reads) => reads.reviewThreads(null)],
    ["request-failed", "rejected", (reads) => reads.reviews()],
    ["timed-out", "stalled", (reads) => reads.timeline()],
    ["redirected", "redirected", (reads) => reads.pullRequest()],
    ["response-unreadable", "text", (reads) => reads.pullRequest()],
    ["date-header-unreadable", "date", (reads) => reads.pullRequest()],
    ["page-not-a-list", "object", (reads) => reads.reviews()],
    ["pages-exceeded", "endless", (reads) => reads.timeline()],
  ];

const secretHeaders = {
  Date: SERVED,
  Link: `<${API}/x?secret=${HEADER_MARKER}>; rel="next"`,
  "X-GitHub-Request-Id": HEADER_MARKER,
};

const leakyReplies: Record<string, (code: string) => Reply> = {
  date: () => json(pullRequestResponse(), { Date: HEADER_MARKER }),
  endless: () => json([{ note: BODY_MARKER }], secretHeaders),
  object: () => json({ message: BODY_MARKER, token: TOKEN }, secretHeaders),
  redirected: () => () => {
    const response = Response.json(
      { message: BODY_MARKER },
      { headers: secretHeaders }
    );
    Object.defineProperty(response, "redirected", { value: true });
    return response;
  },
  rejected: () => () =>
    Promise.reject(new Error(`${UNDERLYING} Bearer ${TOKEN}`)),
  stalled: () => stalled,
  status: (code) =>
    json(
      { message: BODY_MARKER, token: TOKEN },
      secretHeaders,
      Number(code.slice("request-failed ".length))
    ),
  text: () => raw(`${BODY_MARKER} ${TOKEN}`, secretHeaders),
};

test.each(leaky)(
  "a %p failure from a %s response carries no token, body, header, query or underlying message",
  async (code, kind, read) => {
    const reply = leakyReplies[kind]?.(code);
    if (reply === undefined) {
      throw new Error("unknown reply kind");
    }
    const error = await failure(() =>
      read(githubPullRequestReads(options(always(reply), { timeoutMs: 5 })))
    );
    expect(error.message).toBe(code);
    expect(error.name).toBe("GitHubReadError");
    expect(error.cause).toBeUndefined();
    const own = Object.getOwnPropertyNames(error).map(
      (name) => `${name}=${String(Reflect.get(error, name))}`
    );
    const seen = [String(error), error.message, JSON.stringify(error), ...own];
    for (const text of seen) {
      for (const secret of [
        TOKEN,
        "Bearer",
        BODY_MARKER,
        HEADER_MARKER,
        UNDERLYING,
        "per_page",
        "api.github.com",
      ]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(Object.keys(error).toSorted()).toStrictEqual([
      "code",
      "name",
      "status",
    ]);
  }
);

const NEVER: Fetch = () => Promise.reject(new Error("unscripted"));

test.each<[string, Partial<GitHubPullRequestReadsOptions>]>([
  ["a repository with three parts", { repository: "owner/repo/extra" }],
  ["a repository that climbs", { repository: "../x" }],
  ["a repository named ..", { repository: "owner/.." }],
  ["a repository owned by .", { repository: "./repo" }],
  ["a repository named .", { repository: "owner/." }],
  ["an empty repository", { repository: "" }],
  ["a repository with no name", { repository: "owner/" }],
  ["a repository with no owner", { repository: "/repo" }],
  ["a repository with no slash", { repository: "owner" }],
  ["a repository with a query", { repository: "owner/repo?page=2" }],
  ["a repository with a fragment", { repository: "owner/repo#x" }],
  ["a repository with an escape", { repository: "owner/repo%2Fextra" }],
  ["a repository with a space", { repository: "owner/re po" }],
  ["a repository with a trailing newline", { repository: "owner/repo\n" }],
  ["a repository with a host", { repository: "evil.example@x/y:z" }],
  ["a repository with a backslash", { repository: String.raw`owner\repo/x\y` }],
  ["pull request 0", { pullRequest: 0 }],
  ["a negative pull request", { pullRequest: -3 }],
  ["a fractional pull request", { pullRequest: 1.5 }],
  ["a pull request that is not a number", { pullRequest: Number.NaN }],
  ["an unbounded pull request", { pullRequest: Number.POSITIVE_INFINITY }],
  ["an unsafe pull request", { pullRequest: 2 ** 53 }],
  ["an empty token", { token: "" }],
  ["a token with a space", { token: "ghp_abc def" }],
  ["a token with a newline", { token: "ghp_abc\ndef" }],
  ["a token with a trailing newline", { token: `${TOKEN}\n` }],
  ["a token outside ASCII", { token: "ghp_abcé" }],
  ["timeoutMs 0", { timeoutMs: 0 }],
  ["a negative timeoutMs", { timeoutMs: -1 }],
  ["a fractional timeoutMs", { timeoutMs: 0.5 }],
  ["an unbounded timeoutMs", { timeoutMs: Number.POSITIVE_INFINITY }],
  ["maxPages 0", { maxPages: 0 }],
  ["a negative maxPages", { maxPages: -2 }],
  ["a fractional maxPages", { maxPages: 2.5 }],
  ["a maxPages that is not a number", { maxPages: Number.NaN }],
])(
  "%s is rejected at construction with a fixed message and no request",
  (_name, overrides) => {
    const { fetch, requests } = fake();
    let thrown: unknown = null;
    try {
      githubPullRequestReads(options(fetch, overrides));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GitHubReadError);
    expect(String(thrown)).toBe("GitHubReadError: options-invalid");
    expect(requests).toHaveLength(0);
  }
);

test("valid options make no request until a read is called", () => {
  const { fetch, requests } = fake();
  const reads = githubPullRequestReads(options(fetch));
  expect(Object.keys(reads).toSorted()).toStrictEqual([
    "pullRequest",
    "reviewThreads",
    "reviews",
    "timeline",
  ]);
  expect(requests).toHaveLength(0);
});

test("the options are taken at construction, so changing them later changes no request", async () => {
  const { fetch, requests } = fake(json(pullRequestResponse()), json([]));
  const given = options(fetch);
  const reads = githubPullRequestReads(given);
  given.repository = "other/repository";
  given.pullRequest = 99;
  given.token = "ghp_changed";
  given.fetch = NEVER;
  await reads.pullRequest();
  await reads.reviews();
  expect(urls(requests)).toStrictEqual([PULL, reviewsPage(1)]);
  expect(at(requests).headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
});

test("the global fetch has the shape the fetch option takes", () => {
  // Assigned and never called: no test makes a network request.
  const real: Fetch = fetch;
  expect(typeof real).toBe("function");
});

const BEFORE = "2026-01-01T00:00:00Z";
const EARLY = "2026-01-01T00:05:00Z";
const APPROVED = "2026-01-01T00:10:00Z";
const READ = "Thu, 01 Jan 2026 01:00:00 GMT";

/** GitHub as the fake `fetch` serves it: raw fixtures by URL, lists over two pages. */
const github = (requests: string[]): Fetch => {
  const answers: Record<string, Reply> = {
    [PULL]: json(
      pullRequestResponse({ requested_reviewers: [], requested_teams: [] }),
      { Date: READ }
    ),
    [reviewsPage(1)]: json(
      [reviewResponse({ id: 899, state: "COMMENTED", submitted_at: EARLY })],
      nextLink(reviewsPage(2))
    ),
    [reviewsPage(2)]: json([reviewResponse({ submitted_at: APPROVED })]),
    [timelinePage(1)]: json(
      [{ created_at: EARLY, event: "labeled", id: 399 }],
      nextLink(timelinePage(2))
    ),
    [timelinePage(2)]: json([reviewRequestedEvent()]),
  };
  const threads: Record<string, Reply> = {
    "cursor-1": json(threadPageResponse([false])),
    null: json(
      threadPageResponse([true, false], {
        endCursor: "cursor-1",
        hasNextPage: true,
      })
    ),
  };
  return always((request) => {
    const reply =
      request.url === GRAPHQL
        ? threads[String(graphql(request).variables.cursor)]
        : answers[request.url];
    requests.push(`${request.method} ${request.url}`);
    return (reply ?? json({ message: "Not Found" }, {}, 404))(request);
  });
};

const collection = (maxPages: number, requests: string[] = []) =>
  collectPullRequest(
    {
      holdLabel: "forge:hold",
      ledger: {
        observedRevision: { baseSha: BASE, headSha: HEAD, observedAt: BEFORE },
        requiredReviewers: [],
        reviewBindings: {},
      },
      maxThreadPages: 5,
      provenance: provenance("collector"),
      pullRequest: 12,
      repository: REPOSITORY,
    },
    githubPullRequestReads(options(github(requests), { maxPages }))
  );

test("the real collector collects a pull request through these reads", async () => {
  const requests: string[] = [];
  const result = await collection(2, requests);
  const reviewer = "reviewer (user 7)";
  expect(result).toMatchObject({
    evidence: {
      assignments: { recorded: true, requiredReviewers: [reviewer] },
      humanReviews: [{ reviewer, state: "approved", subject: subject(12) }],
      mergeAuthorized: true,
      mergeable: true,
      open: true,
      subject: subject(12),
      unresolvedThreads: 2,
    },
    ledger: {
      reviewBindings: { "900": { observedAt: BEFORE, submittedAt: APPROVED } },
    },
    status: "collected",
  });
  const reviews = [`GET ${reviewsPage(1)}`, `GET ${reviewsPage(2)}`];
  const rest = [
    `GET ${timelinePage(1)}`,
    `GET ${timelinePage(2)}`,
    `POST ${GRAPHQL}`,
    `POST ${GRAPHQL}`,
  ];
  expect(requests).toStrictEqual([
    ...reviews,
    `GET ${PULL}`,
    ...rest,
    `GET ${PULL}`,
    ...reviews,
    ...rest,
  ]);
});

test("the real collector reports a list cut off by maxPages as unavailable, never as a shorter list", async () => {
  expect(await collection(1)).toStrictEqual({
    reason: "read-failed",
    status: "unavailable",
  });
});
