import path from "node:path";

import { HOSTED } from "./agent-review-fixtures.ts";
import { HEAD } from "./evidence-fixtures.ts";
import {
  adoption,
  BOT,
  codexPass,
  comments,
  comment,
  BODY_MARKER,
} from "./gate-codex-fixtures.ts";
import { gatePolicy } from "./gate-fixtures.ts";
import type { ScriptedPass, ScriptedResponse } from "./gate-fixtures.ts";
import { gateArgs, run } from "./gate-test-harness.ts";
import type { Workspace } from "./gate-test-harness.ts";

export const cleanComment = () => {
  const value = comment();
  return { ...value, body: String(value.body).replace(BODY_MARKER, "").trim() };
};

export const REPORTER = 3456;
export const OTHER_REPORTER = 7890;
export const TIME = "2024-01-01T00:30:00Z";
export const POLICY_REVISION = "d".repeat(40);
export const pageInfo = { endCursor: null, hasNextPage: false };
export const actor = (id = REPORTER, login = "reporting-bot[bot]") => ({
  __typename: "Bot",
  databaseId: id,
  login,
});
export const report = (overrides: Record<string, unknown> = {}) => ({
  author: actor(),
  body: "",
  commit: { oid: HEAD },
  editor: null,
  id: "REPORT_1",
  lastEditedAt: null,
  updatedAt: TIME,
  url: "https://github.com/example/project/pull/12#discussion_r1",
  ...overrides,
});
export const reportingThread = (overrides: Record<string, unknown> = {}) => ({
  comments: { nodes: [report()], pageInfo },
  id: "FINDING_THREAD_1",
  isOutdated: false,
  isResolved: false,
  ...overrides,
});
export const connection = (field: string, nodes: unknown[]) => ({
  data: { repository: { pullRequest: { [field]: { nodes, pageInfo } } } },
});
export const findingSource = (overrides: Record<string, unknown> = {}) => ({
  accountId: REPORTER,
  actorType: "Bot",
  externalCoverage: "qualified",
  formats: [
    "github-thread-v1",
    "devin-review-v1",
    "codex-summary-v1",
    "cursor-summary-v1",
  ],
  qualificationRef: "fixture://qualified-reporting-surfaces",
  reviewer: "reporting-bot",
  surfaces: ["review", "issue-comment", "thread-comment"],
  ...overrides,
});
export const findingSources = (overrides: Record<string, unknown> = {}) => ({
  policyRevision: POLICY_REVISION,
  resolution: "github-native",
  sources: [
    findingSource({
      accountId: BOT,
      formats: ["github-thread-v1", "codex-summary-v1"],
      reviewer: HOSTED,
    }),
    findingSource(),
  ],
  unqualifiedSources: [],
  ...overrides,
});
export const scopedPolicy = (overrides: Record<string, unknown> = {}) => {
  const { reviewer, ...configuration } = adoption({
    findingHistory: "adapter-only",
  });
  return gatePolicy({
    findingSources: findingSources(),
    reviewAdapters: [{ adapter: "codex-github", configuration, reviewer }],
    schemaVersion: 2,
    ...overrides,
  });
};
export interface FindingPass extends ScriptedPass {
  findingReviews: ScriptedResponse;
  findingThreads: ScriptedResponse;
}
export const findingPass = (
  overrides: Partial<FindingPass> = {}
): FindingPass => ({
  ...codexPass({ comments: { body: comments(cleanComment()) } }),
  findingReviews: { body: connection("reviews", []) },
  findingThreads: { body: connection("reviewThreads", []) },
  ...overrides,
});
export const invoke = (
  ws: Workspace,
  passes: FindingPass[] = [findingPass()],
  policy = scopedPolicy()
) =>
  run(ws, gateArgs(ws, { policy, review: null }), {
    preloads: [path.join(import.meta.dir, "finding-sources-fetch-preload.ts")],
    script: { passes },
  });
export const sourceComments = (...nodes: unknown[]) => ({
  body: comments(...nodes),
});
