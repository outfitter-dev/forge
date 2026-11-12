import { expect, test } from "bun:test";

import { parseCodexSummary, parseIssueCommentPage } from "../src/index.ts";
import {
  commentPageResponse,
  HEAD,
  issueCommentResponse,
} from "./github-fixtures.ts";

const BOT = 199_175_422;
const HEADER = "<!-- codex-pull-request-review-summary -->";
const inactive = () => ({
  commit_sha: null,
  has_any_findings: null,
  has_unresolved_findings: null,
  status: null,
});
const code = (overrides: Record<string, unknown> = {}) => ({
  commit_sha: HEAD,
  has_any_findings: false,
  has_unresolved_findings: false,
  status: "completed",
  ...overrides,
});
const state = (
  codeReview: unknown = code(),
  securityReview: unknown = inactive()
) => ({ code_review: codeReview, security_review: securityReview });
const body = (value: unknown = state()) =>
  `${HEADER}\n<!-- codex-review-state:v1 ${JSON.stringify(value)} -->\nSummary prose`;
const comment = (overrides: Record<string, unknown> = {}) => {
  const [result] = parseIssueCommentPage(
    commentPageResponse([issueCommentResponse({ body: body(), ...overrides })])
  ).comments;
  if (!result) {
    throw new Error("missing fixture comment");
  }
  return result;
};
const parse = (text: string) =>
  parseCodexSummary([comment({ body: text })], BOT);

test("a current observed clean state is a candidate with identity and source references retained", () => {
  const source = comment();
  expect(parseCodexSummary([source], BOT)).toEqual({
    adverseComments: [],
    cleanCandidate: true,
    reason: null,
    reportedAdverse: false,
    state: {
      codeReview: {
        commitSha: HEAD,
        hasAnyFindings: false,
        hasUnresolvedFindings: false,
        status: "completed",
      },
      securityReview: null,
    },
    status: "parsed",
    summary: source,
  });
});

test("the named head is preserved for later subject binding", () => {
  const olderHead = "c".repeat(40);
  const result = parse(body(state(code({ commit_sha: olderHead }))));
  expect(result.state?.codeReview.commitSha).toBe(olderHead);
  expect(result.status).toBe("parsed");
});

test.each(["in_progress", "queued", "unknown-provider-state"])(
  "noncompleted %s is observable without establishing a clean candidate",
  (status) => {
    expect(parse(body(state(code({ status }))))).toMatchObject({
      cleanCandidate: false,
      reportedAdverse: false,
      state: { codeReview: { status } },
      status: "parsed",
    });
  }
);

test.each([{ has_any_findings: true }, { has_unresolved_findings: true }])(
  "completed adverse code review stays parsed and adverse",
  (flags) => {
    const result = parse(body(state(code(flags))));
    expect(result).toMatchObject({
      cleanCandidate: false,
      reportedAdverse: true,
      status: "parsed",
    });
    expect(result.adverseComments).toHaveLength(1);
  }
);

test("active security observations never establish a clean candidate and retain adverse flags", () => {
  expect(parse(body(state(code(), code())))).toMatchObject({
    cleanCandidate: false,
    reportedAdverse: false,
    status: "parsed",
  });
  expect(
    parse(body(state(code(), code({ has_any_findings: true }))))
  ).toMatchObject({
    cleanCandidate: false,
    reportedAdverse: true,
    status: "parsed",
  });
});

test.each([
  { __typename: "Bot", databaseId: 999, login: "review-bot[bot]" },
  { __typename: "User", databaseId: BOT, login: "review-bot[bot]" },
  null,
  { __typename: "Mannequin", login: "review-bot[bot]" },
])("impostor or unknown author cannot establish Codex evidence", (author) => {
  const result = parseCodexSummary(
    [comment({ author, body: body(state(code({ has_any_findings: true }))) })],
    BOT
  );
  expect(result).toMatchObject({
    cleanCandidate: false,
    reason: "summary-missing",
    reportedAdverse: false,
    status: "unavailable",
  });
});

test.each([
  { __typename: "User", databaseId: 77, login: "human" },
  { __typename: "Bot", databaseId: 999, login: "review-bot[bot]" },
  null,
  { __typename: "Mannequin", login: "migrated-editor" },
])(
  "unverified editor prevents clean evidence while authenticated author's adverse flag survives",
  (editor) => {
    const result = parseCodexSummary(
      [
        comment({
          body: body(state(code({ has_any_findings: true }))),
          editor,
        }),
      ],
      BOT
    );
    expect(result).toMatchObject({
      cleanCandidate: false,
      reason: "editor-unverified",
      reportedAdverse: true,
      status: "unavailable",
    });
  }
);

test.each([0, -1, 1.5, Number.NaN])(
  "invalid configured bot identity fails closed",
  (id) => {
    expect(parseCodexSummary([comment()], id)).toMatchObject({
      cleanCandidate: false,
      reason: "identity-invalid",
      status: "unavailable",
    });
  }
);

test("bot login changes do not change stable account attribution", () => {
  expect(
    parseCodexSummary(
      [
        comment({
          author: { __typename: "Bot", databaseId: BOT, login: "renamed-bot" },
        }),
      ],
      BOT
    ).cleanCandidate
  ).toBe(true);
});

test.each([
  `${HEADER}\nNo state`,
  body().replace("v1", "v2"),
  `${body()}\n<!-- codex-review-state:v1 {} -->`,
  `${body()}\ncodex-review-state:`,
  body() + HEADER,
])("missing, unsupported or ambiguous markers fail closed", (text) => {
  expect(parse(text)).toMatchObject({
    cleanCandidate: false,
    reason: "marker-invalid",
    status: "unavailable",
  });
});

test("summary prefix is exact and absence remains unavailable", () => {
  expect(parse(` ${body()}`)).toMatchObject({
    reason: "summary-missing",
    status: "unavailable",
  });
  expect(parseCodexSummary([], BOT)).toMatchObject({
    reason: "summary-missing",
    status: "unavailable",
  });
});

test.each(
  [
    {},
    [],
    null,
    { ...state(), unexpected: true },
    state({ ...code(), extra: true }),
    state(inactive()),
    state(code({ commit_sha: "abc" })),
    state(code({ commit_sha: HEAD.toUpperCase() })),
    state(code({ has_any_findings: null })),
    state(code({ has_unresolved_findings: "false" })),
    state(code({ status: null })),
    state(code({ status: "" })),
    state(code(), { ...inactive(), status: "completed" }),
  ].map((value) => ({ value }))
)("malformed state cannot become a clean review", ({ value }) => {
  expect(parse(body(value))).toMatchObject({
    cleanCandidate: false,
    reason: "state-invalid",
    status: "unavailable",
  });
});

test("malformed JSON syntax is unavailable", () => {
  expect(
    parse(`${HEADER}\n<!-- codex-review-state:v1 {invalid JSON} -->`)
  ).toMatchObject({ reason: "state-invalid", status: "unavailable" });
});

test("a long unterminated state marker stays unavailable", () => {
  expect(
    parse(`${HEADER}\n<!-- codex-review-state:! ${" ".repeat(64_000)}`)
  ).toMatchObject({
    cleanCandidate: false,
    reason: "marker-invalid",
    status: "unavailable",
  });
});

test("long escaped string tokens preserve duplicate-member and adverse detection", () => {
  const json = JSON.stringify(
    state(code({ has_any_findings: true, status: '\\"'.repeat(16_000) }))
  ).replace(
    '"has_any_findings":true',
    '"has_any_findings":true,"has_any_findings":false'
  );
  expect(
    parse(`${HEADER}\n<!-- codex-review-state:v1 ${json} -->`)
  ).toMatchObject({
    cleanCandidate: false,
    reason: "state-invalid",
    reportedAdverse: true,
    status: "unavailable",
  });
});

test("duplicate summaries remain unavailable and preserve all authenticated adverse references", () => {
  const adverse = comment({
    body: body(state(code({ has_any_findings: true }))),
    databaseId: 501,
    id: "IC_501",
  });
  const result = parseCodexSummary([comment(), adverse], BOT);
  expect(result).toMatchObject({
    cleanCandidate: false,
    reason: "summary-ambiguous",
    reportedAdverse: true,
    status: "unavailable",
  });
  expect(result.adverseComments).toEqual([adverse]);
  expect(parseCodexSummary([comment(), comment()], BOT).reason).toBe(
    "summary-ambiguous"
  );
});

test("unrelated human summaries cannot impersonate or replace the expected bot", () => {
  const human = comment({
    author: { __typename: "User", databaseId: 99, login: "human" },
    databaseId: 501,
    id: "IC_501",
  });
  expect(parseCodexSummary([human, comment()], BOT).cleanCandidate).toBe(true);
});

test.each([
  JSON.stringify(state()).replace(
    '"has_any_findings":false',
    '"has_any_findings":true,"has_any_findings":false'
  ),
  JSON.stringify(state()).replace(
    '"has_any_findings":false',
    '"has_any_findings":true,"has_any_find\\u0069ngs":false'
  ),
  JSON.stringify(state()).replace(
    '"code_review":',
    `"code_review":${JSON.stringify(code({ has_any_findings: true }))},"code_review":`
  ),
  JSON.stringify(state()).replace(
    '"status":"completed"',
    '"status":"completed","status":"completed"'
  ),
])("duplicate JSON members cannot masquerade as clean", (json) => {
  const result = parse(`${HEADER}\n<!-- codex-review-state:v1 ${json} -->`);
  expect(result).toMatchObject({
    cleanCandidate: false,
    reason: "state-invalid",
    status: "unavailable",
  });
});

test("adverse true survives duplicate JSON member overwrite", () => {
  const json = JSON.stringify(state()).replace(
    '"has_any_findings":false',
    '"has_any_findings":true,"has_any_findings":false'
  );
  expect(
    parse(`${HEADER}\n<!-- codex-review-state:v1 ${json} -->`).reportedAdverse
  ).toBe(true);
});

test("adverse flags survive unsupported versions, missing prefix, malformed known shape and duplicate markers", () => {
  const adverse = body(state(code({ has_any_findings: true, status: null })));
  for (const text of [
    adverse,
    adverse.replace("v1", "v2"),
    adverse.replace(HEADER, ""),
    `${adverse}\n<!-- codex-review-state:v1 {} -->`,
  ]) {
    expect(parse(text)).toMatchObject({
      cleanCandidate: false,
      reportedAdverse: true,
      status: "unavailable",
    });
  }
});
