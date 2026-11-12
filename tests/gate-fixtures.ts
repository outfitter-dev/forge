import type { CheckReceipt, CheckSource } from "../src/check-types.ts";
import { localAttempt, policyV2 } from "./agent-review-fixtures.ts";
import { BASE, HEAD, REPOSITORY, subject } from "./evidence-fixtures.ts";
import { pullRequestResponse, threadPageResponse } from "./github-fixtures.ts";

/** The number `pullRequestResponse` gives its pull request. */
export const PULL_REQUEST = 12;
export const HOLD = "forge:hold";

/** A gate policy over the version 2 fixture policy; Forge's own check mapping. */
export const gatePolicy = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  checks: { build: "check", lint: "check", test: "check" },
  evidence: policyV2(),
  kind: "forge-gate-policy",
  mergeAuthorization: { holdLabel: HOLD, rule: "same-repository-unless-held" },
  schemaVersion: 1,
  ...overrides,
});

export const source = (head = HEAD): CheckSource => ({
  base: BASE,
  coverage: "tracked-and-nonignored-untracked",
  dirty: false,
  head,
  indexDigest: "8".repeat(64),
  mergeBase: BASE,
  tree: "c".repeat(40),
  untracked: 0,
  worktreeDigest: "9".repeat(64),
});

/** A persisted, stable, passing `forge check` run of `id` on the fixture revision. */
export const receipt = (
  id = "check",
  overrides: Partial<CheckReceipt> = {}
): CheckReceipt => ({
  admission: "started",
  cancellation: null,
  cause: "unclassified",
  check: { commandDigest: "f".repeat(64), id },
  completion: "observed",
  configAfter: "e".repeat(64),
  configBefore: "e".repeat(64),
  diagnostic: "command-passed",
  durationMs: 1200,
  evidence: "stable",
  exitCode: 0,
  finishedAt: "2026-01-01T00:00:02.000Z",
  kind: "forge-check",
  outcome: "passed",
  receiptId: `receipt-${id}`,
  recording: { path: "/fixture/receipt.json", state: "persisted" },
  repository: REPOSITORY,
  runtime: { arch: "arm64", bun: "1.4.4", platform: "darwin" },
  schemaVersion: 1,
  signal: null,
  sourceAfter: source(),
  sourceBefore: source(),
  startedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

/** One acceptable complete agent review of the fixture revision, and an empty recorded ledger. */
export const cleanReview = (): Record<string, unknown> => ({
  agentReviews: [localAttempt({ subject: subject(PULL_REQUEST) })],
  reviewFindings: { findings: [], recorded: true },
  reviewLadder: null,
});

/** How the preloaded `fetch` answers one request. */
export interface ScriptedResponse {
  body: unknown;
  /** The `Date` header. Only the pull request read needs one. */
  date?: string;
  /** Report that a redirect was followed. */
  redirected?: boolean;
  /** 200 when absent. */
  status?: number;
}

/** What one pass of the collector's four reads is answered with. */
export interface ScriptedPass {
  pullRequest: ScriptedResponse;
  reviews: ScriptedResponse;
  threads: ScriptedResponse;
  timeline: ScriptedResponse;
}

/**
 * The nth request of each read is answered from the nth pass, and any later
 * one from the last. `interference` is written when the first request arrives:
 * it stands for another process changing a file while GitHub is being read.
 */
export interface GateScript {
  passes: ScriptedPass[];
  interference?: { file: string; text: string };
}

/** Every time GitHub serves or records is long past, whatever the test machine's clock says. */
export const SERVED_EARLY = "Mon, 01 Jan 2024 00:05:00 GMT";
export const APPROVED_AT = "2024-01-01T00:10:00Z";
export const SERVED = "Mon, 01 Jan 2024 01:00:00 GMT";

/** An open, mergeable pull request from the base repository that nobody was asked to review. */
export const pullRequest = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> =>
  pullRequestResponse({
    requested_reviewers: [],
    requested_teams: [],
    ...overrides,
  });

export const pass = (overrides: Partial<ScriptedPass> = {}): ScriptedPass => ({
  pullRequest: { body: pullRequest(), date: SERVED },
  reviews: { body: [] },
  threads: { body: threadPageResponse([]) },
  timeline: { body: [] },
  ...overrides,
});
