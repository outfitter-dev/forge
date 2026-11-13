import { HOSTED } from "./agent-review-fixtures.ts";
import { HEAD } from "./evidence-fixtures.ts";
import { gatePolicy, pass } from "./gate-fixtures.ts";
import type { ScriptedPass } from "./gate-fixtures.ts";
import {
  commentPageResponse,
  issueCommentResponse,
  threadResponse,
} from "./github-fixtures.ts";

export const BOT = 199_175_422;
export const STATEMENT =
  "separate-hosted-invocation-without-inherited-author-context";
export const BODY_MARKER = "private-code-review-body";
export const adoption = (overrides: Record<string, unknown> = {}) => ({
  botAccountId: BOT,
  independence: {
    id: "fixture-independence",
    policyRevision: "f".repeat(40),
    statement: STATEMENT,
  },
  reviewer: HOSTED,
  ...overrides,
});
export const codexPolicy = (overrides: Record<string, unknown> = {}) =>
  gatePolicy({ codexReview: adoption(), ...overrides });
export const comment = (
  code: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
) =>
  issueCommentResponse({
    body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: HEAD, has_any_findings: false, has_unresolved_findings: false, status: "completed", ...code }, security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null } })} -->\n${BODY_MARKER}`,
    lastEditedAt: "2024-01-01T00:30:00Z",
    updatedAt: "2024-01-01T00:30:00Z",
    ...overrides,
  });
export const comments = (...nodes: unknown[]) => commentPageResponse(nodes);
export const thread = (isResolved = false) =>
  threadResponse({
    comments: {
      nodes: [
        {
          author: {
            __typename: "Bot",
            databaseId: BOT,
            login: "review-bot[bot]",
          },
        },
      ],
    },
    id: "T1",
    isResolved,
  });
export const threads = (...nodes: unknown[]) => ({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes,
          pageInfo: { endCursor: null, hasNextPage: false },
        },
      },
    },
  },
});
export const codexPass = (
  overrides: Partial<ScriptedPass> = {}
): ScriptedPass =>
  pass({ comments: { body: comments(comment()) }, ...overrides });
