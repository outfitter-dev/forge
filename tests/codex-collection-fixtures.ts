import type {
  PullRequestCodexReviewConfig,
  PullRequestCollectionRequest,
  PullRequestCollectionResult,
  PullRequestCommentReads,
  PullRequestReads,
} from "../src/index.ts";
import { input as pureInput, READ } from "./codex-review-fixtures.ts";
import { provenance, REPOSITORY } from "./evidence-fixtures.ts";
import {
  commentPageResponse,
  issueCommentResponse,
  pullRequestResponse,
  threadPageResponse,
  threadResponse,
} from "./github-fixtures.ts";

export const config = (
  overrides: Partial<PullRequestCodexReviewConfig> = {}
): PullRequestCodexReviewConfig => {
  const given = pureInput();
  return {
    attestation: given.attestation,
    botAccountId: given.botAccountId,
    issuer: given.issuer,
    maxCommentPages: 2,
    reviewer: given.reviewer,
    ...overrides,
  };
};
export const request = (
  overrides: Partial<PullRequestCollectionRequest> = {}
): PullRequestCollectionRequest => ({
  codexReview: config(),
  holdLabel: "forge:hold",
  ledger: {
    observedRevision: pureInput().snapshot,
    requiredReviewers: [],
    reviewBindings: {},
  },
  maxThreadPages: 2,
  provenance: provenance("collector"),
  pullRequest: 12,
  repository: REPOSITORY,
  ...overrides,
});
export const comment = (overrides: Record<string, unknown> = {}) => {
  const source = pureInput().summary.summary;
  if (source === null) {
    throw new Error("missing summary fixture");
  }
  return issueCommentResponse({ body: source.body, ...overrides });
};
export const thread = (isResolved = false) =>
  threadResponse({
    comments: {
      nodes: [
        {
          author: {
            __typename: "Bot",
            databaseId: config().botAccountId,
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
export interface Pass {
  comments: unknown[];
  pullRequest: unknown;
  reviews: unknown;
  servedAt: string;
  threads: unknown;
  timeline: unknown;
}
export const pass = (overrides: Partial<Pass> = {}): Pass => ({
  comments: [commentPageResponse([comment()])],
  pullRequest: pullRequestResponse({
    requested_reviewers: [],
    requested_teams: [],
  }),
  reviews: [],
  servedAt: READ,
  threads: threadPageResponse([]),
  timeline: [],
  ...overrides,
});
export const scripted = (first = pass(), second = first) => {
  const calls: string[] = [];
  const passes = [first, second];
  const counters = {
    comments: 0,
    pullRequest: 0,
    reviews: 0,
    threads: 0,
    timeline: 0,
  };
  const answer = (name: keyof typeof counters) => {
    const value = passes[Math.min(counters[name], 1)];
    counters[name] += 1;
    if (!value) {
      throw new Error("missing fixture pass");
    }
    return value;
  };
  let paging = first;
  const reads: PullRequestReads & PullRequestCommentReads = {
    issueComments: (cursor) => {
      calls.push(`comments:${cursor}`);
      if (cursor === null) {
        paging = answer("comments");
      }
      return Promise.resolve(
        paging.comments[
          cursor === null ? 0 : Number(cursor.slice("comment-".length))
        ]
      );
    },
    pullRequest: () => {
      calls.push("pullRequest");
      const given = answer("pullRequest");
      return Promise.resolve({
        body: given.pullRequest,
        servedAt: given.servedAt,
      });
    },
    reviewThreads: (cursor) => {
      calls.push(`threads:${cursor}`);
      return Promise.resolve(answer("threads").threads);
    },
    reviews: () => {
      calls.push("reviews");
      return Promise.resolve(answer("reviews").reviews);
    },
    timeline: () => {
      calls.push("timeline");
      return Promise.resolve(answer("timeline").timeline);
    },
  };
  return { calls, reads };
};
export const collected = (result: PullRequestCollectionResult) => {
  if (result.status !== "collected" || result.codexReview === undefined) {
    throw new Error(
      `fixture did not collect Codex evidence: ${JSON.stringify(result)}`
    );
  }
  return { ...result, codexReview: result.codexReview };
};
