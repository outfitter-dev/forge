import { expect, test } from "bun:test";

import {
  GitHubReadError,
  parseIssueCommentPage,
  readIssueComments,
} from "../src/index.ts";
import { GitHubResponseError } from "../src/parse-github-pull-request.ts";
import {
  commentPageResponse,
  issueCommentResponse,
} from "./github-fixtures.ts";

const PATH = "comments.data.repository.pullRequest.comments";

const rejects = (value: unknown, path: string) => {
  try {
    parseIssueCommentPage(value);
  } catch (error) {
    expect(error).toBeInstanceOf(GitHubResponseError);
    expect((error as GitHubResponseError).path).toBe(path);
    return;
  }
  throw new Error("expected unreadable comment page");
};

test("comment pages preserve stable identity, current author/editor, body, native reference and update times", () => {
  expect(
    parseIssueCommentPage(commentPageResponse([issueCommentResponse()]))
  ).toEqual({
    comments: [
      {
        author: { id: 199_175_422, login: "review-bot[bot]", type: "Bot" },
        body: "ordinary issue comment",
        editor: { id: 199_175_422, login: "review-bot[bot]", type: "Bot" },
        id: 500,
        lastEditedAt: "2026-01-01T00:10:00Z",
        nativeRef:
          "https://github.com/example/project/pull/12#issuecomment-500",
        nodeId: "IC_500",
        updatedAt: "2026-01-01T00:10:00Z",
      },
    ],
    nextCursor: null,
  });
  expect(
    parseIssueCommentPage(
      commentPageResponse([], { endCursor: "next", hasNextPage: true })
    ).nextCursor
  ).toBe("next");
});

test.each([
  null,
  { __typename: "Mannequin", login: "migrated" },
  { __typename: "User", databaseId: 10_137, login: "ghost" },
])(
  "unavailable or migrated author/editor identity remains explicit unknown",
  (identity) => {
    expect(
      parseIssueCommentPage(
        commentPageResponse([
          issueCommentResponse({
            author: identity,
            editor: identity,
            lastEditedAt: null,
          }),
        ])
      ).comments[0]
    ).toMatchObject({ author: null, editor: null, lastEditedAt: null });
  }
);

test("empty comment bodies are valid observations", () => {
  expect(
    parseIssueCommentPage(
      commentPageResponse([issueCommentResponse({ body: "" })])
    ).comments[0]?.body
  ).toBe("");
});

test.each([
  { field: "databaseId", value: 0 },
  { field: "databaseId", value: 1.5 },
  { field: "id", value: "" },
  { field: "url", value: null },
  { field: "body", value: null },
  { field: "updatedAt", value: "2026-02-30T00:00:00Z" },
  { field: "lastEditedAt", value: undefined },
  { field: "author", value: undefined },
  { field: "editor", value: undefined },
])("malformed comment $field fails closed", ({ field, value }) => {
  rejects(
    commentPageResponse([issueCommentResponse({ [field]: value })]),
    `${PATH}.nodes[0].${field}`
  );
});

test.each(["author", "editor"])(
  "malformed $identity account cannot masquerade as unknown",
  (field) => {
    rejects(
      commentPageResponse([
        issueCommentResponse({
          [field]: { __typename: "Bot", databaseId: null, login: "bot" },
        }),
      ]),
      `${PATH}.nodes[0].${field}.databaseId`
    );
  }
);

test.each([
  { path: "comments", value: null },
  {
    path: "comments.errors",
    value: { ...commentPageResponse([]), errors: [] },
  },
  { path: "comments.data.repository", value: { data: { repository: null } } },
  {
    path: `${PATH}.nodes`,
    value: commentPageResponse(null as unknown as unknown[]),
  },
  { path: `${PATH}.nodes[0]`, value: commentPageResponse([null]) },
  { path: `${PATH}.pageInfo.hasNextPage`, value: commentPageResponse([], {}) },
  {
    path: `${PATH}.pageInfo.endCursor`,
    value: commentPageResponse([], { endCursor: null, hasNextPage: true }),
  },
])("incomplete comment connection fails at $path", ({ path, value }) =>
  rejects(value, path)
);

test.each([
  issueCommentResponse({ id: "IC_other" }),
  issueCommentResponse({ databaseId: 501 }),
])("duplicate database or node identity on a page is rejected", (second) => {
  rejects(
    commentPageResponse([issueCommentResponse(), second]),
    `${PATH}.nodes[1]`
  );
});

const reads = (...pages: unknown[]) => {
  const cursors: (string | null)[] = [];
  return {
    cursors,
    issueComments: (cursor: string | null) => {
      cursors.push(cursor);
      return Promise.resolve(pages[cursors.length - 1]);
    },
  };
};

test("every comment page is read in order with its cursor", async () => {
  const fixture = reads(
    commentPageResponse([issueCommentResponse()], {
      endCursor: "next",
      hasNextPage: true,
    }),
    commentPageResponse([
      issueCommentResponse({ databaseId: 501, id: "IC_501" }),
    ])
  );
  const comments = await readIssueComments(fixture, 2);
  expect(comments.map((comment) => comment.id)).toEqual([500, 501]);
  expect(fixture.cursors).toEqual([null, "next"]);
});

test("an exceeded comment page bound never returns partial comments", async () => {
  await expect(
    readIssueComments(
      reads(
        commentPageResponse([issueCommentResponse()], {
          endCursor: "next",
          hasNextPage: true,
        })
      ),
      1
    )
  ).rejects.toMatchObject({ code: "pages-exceeded" });
});

test.each([0, -1, 1.5, Number.NaN])(
  "invalid page bound %s makes no read",
  async (bound) => {
    const fixture = reads();
    await expect(readIssueComments(fixture, bound)).rejects.toMatchObject({
      code: "options-invalid",
    });
    expect(fixture.cursors).toEqual([]);
  }
);

test("duplicate identities across pages and repeated cursors are unreadable", async () => {
  const first = commentPageResponse([issueCommentResponse()], {
    endCursor: "next",
    hasNextPage: true,
  });
  await expect(
    readIssueComments(
      reads(first, commentPageResponse([issueCommentResponse()])),
      2
    )
  ).rejects.toBeInstanceOf(GitHubResponseError);
  await expect(
    readIssueComments(
      reads(
        first,
        commentPageResponse([], { endCursor: "next", hasNextPage: true })
      ),
      2
    )
  ).rejects.toBeInstanceOf(GitHubResponseError);
});

test("read failure is sanitized while structured transport failures keep their code", async () => {
  const secret = "ghp_private-source-error";
  await expect(
    readIssueComments(
      { issueComments: () => Promise.reject(new Error(secret)) },
      1
    )
  ).rejects.toThrow(/^request-failed$/u);
  const error = new GitHubReadError("timed-out");
  await expect(
    readIssueComments({ issueComments: () => Promise.reject(error) }, 1)
  ).rejects.toBe(error);
});
