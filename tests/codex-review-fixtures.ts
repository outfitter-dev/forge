import {
  codexReviewEvidence,
  evaluateEvidence,
  parseCodexSummary,
  parseIssueCommentPage,
} from "../src/index.ts";
import type {
  CodexReviewEvidenceInput,
  CodexReviewEvidenceResult,
} from "../src/index.ts";
import {
  HOSTED,
  hostedProvenance,
  passingPrV2,
  policyV2,
} from "./agent-review-fixtures.ts";
import { BASE, HEAD, REPOSITORY, subject } from "./evidence-fixtures.ts";
import {
  commentPageResponse,
  issueCommentResponse,
} from "./github-fixtures.ts";

export const BOT = 199_175_422;
export const START = "2026-01-01T00:00:00Z";
export const UPDATED = "2026-01-01T00:10:00Z";
export const READ = "2026-01-01T00:11:00Z";
export const DEADLINE = "2026-01-01T00:15:00Z";
export const summary = (
  code: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
  security?: unknown
) => {
  const body = `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(
    {
      code_review: {
        commit_sha: HEAD,
        has_any_findings: false,
        has_unresolved_findings: false,
        status: "completed",
        ...code,
      },
      security_review: security ?? {
        commit_sha: null,
        has_any_findings: null,
        has_unresolved_findings: null,
        status: null,
      },
    }
  )} -->\nprivate summary prose`;
  return parseCodexSummary(
    parseIssueCommentPage(
      commentPageResponse([
        issueCommentResponse({ body, updatedAt: UPDATED, ...overrides }),
      ])
    ).comments,
    BOT
  );
};

export const input = (
  overrides: Partial<CodexReviewEvidenceInput> = {}
): CodexReviewEvidenceInput => {
  const reviewer = policyV2().agentReview.reviewers.find(
    (item) => item.reviewer === HOSTED
  );
  if (!reviewer || reviewer.rung !== "hosted") {
    throw new Error("missing hosted fixture reviewer");
  }
  return {
    attestation: {
      botAccountId: BOT,
      id: "fixture-independence",
      policyRevision: "trusted-policy-revision",
      repository: REPOSITORY,
      reviewer: HOSTED,
    },
    botAccountId: BOT,
    findings: { findings: [], recorded: false },
    findingsComplete: true,
    issuer: hostedProvenance(),
    reviewer,
    servedAt: READ,
    snapshot: { baseSha: BASE, headSha: HEAD, observedAt: START },
    subject: subject(12),
    summary: summary(),
    threads: [],
    ...overrides,
  };
};

export const thread = (id = "T1", isResolved = false) => ({
  firstAuthor: { id: BOT, login: "review-bot[bot]", type: "Bot" },
  id,
  isResolved,
});

export const evaluate = (
  result: CodexReviewEvidenceResult,
  extraAttempts = [] as CodexReviewEvidenceResult["agentReviews"][number][],
  policy = policyV2()
) => {
  const [attempt] = result.agentReviews;
  const pr = passingPrV2(
    attempt.subject.id,
    attempt.subject.headSha,
    attempt.subject.baseSha
  );
  const evaluated = evaluateEvidence(
    {
      event: "pull_request",
      pullRequest: {
        ...pr,
        agentReviews: [...result.agentReviews, ...extraAttempts],
        reviewFindings: result.reviewFindings,
        reviewLadder: result.reviewLadder,
      },
      schemaVersion: 2,
    },
    policy
  );
  if (evaluated.status !== "evaluated" || evaluated.schemaVersion !== 2) {
    throw new Error(JSON.stringify(evaluated));
  }
  const gate = evaluated.gates.find((item) => item.name === "agent-review");
  if (!gate) {
    throw new Error("missing agent-review gate");
  }
  return {
    codes: gate.reasons.map((item) => item.code),
    conclusion: gate.conclusion,
    eligible: evaluated.eligible,
  };
};

export const evidence = (overrides: Partial<CodexReviewEvidenceInput> = {}) =>
  codexReviewEvidence(input(overrides));
