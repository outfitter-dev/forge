import { expect, test } from "bun:test";

import type { PullRequestCollectionRequest } from "../src/collect-pull-request-types.ts";
import { collectPullRequest } from "../src/collect-pull-request.ts";
import { parseFindingSourcesPolicy } from "../src/finding-source-policy.ts";
import { emptyReviewLedgerEntry } from "../src/review-ledger-entry.ts";
import { request as legacyRequest } from "./codex-collection-fixtures.ts";
import { provenance, REPOSITORY } from "./evidence-fixtures.ts";
import { connection, findingSources } from "./finding-sources-gate-fixtures.ts";
import { pullRequestResponse, threadPageResponse } from "./github-fixtures.ts";

const request = (): PullRequestCollectionRequest => ({
  findingSources: parseFindingSourcesPolicy(findingSources()),
  holdLabel: "forge:hold",
  ledger: emptyReviewLedgerEntry(),
  maxThreadPages: 2,
  provenance: provenance("collector"),
  pullRequest: 12,
  repository: REPOSITORY,
});
const reads = () => ({
  issueComments: () => Promise.resolve(connection("comments", [])),
  pullRequest: () =>
    Promise.resolve({
      body: pullRequestResponse({
        requested_reviewers: [],
        requested_teams: [],
      }),
      servedAt: "2026-01-01T01:00:00Z",
    }),
  reviewThreads: () => Promise.resolve(threadPageResponse([])),
  reviews: () => Promise.resolve([]),
  scopedReviewThreads: () => Promise.resolve(connection("reviewThreads", [])),
  scopedReviews: () => Promise.resolve(connection("reviews", [])),
  timeline: () => Promise.resolve([]),
});

test("missing finding reads fail before any requested source is read", async () => {
  let called = false;
  const source = reads();
  const { scopedReviews: _scopedReviews, ...incomplete } = source;
  const result = await collectPullRequest(request(), {
    ...incomplete,
    pullRequest: () => {
      called = true;
      return source.pullRequest();
    },
  });
  expect(result).toEqual({
    reason: "finding-read-missing",
    status: "unavailable",
  });
  expect(called).toBe(false);
});

test("mixed legacy Codex and scoped source policies are rejected before reads", async () => {
  let called = false;
  const source = reads();
  const input = {
    ...legacyRequest(),
    findingSources: parseFindingSourcesPolicy(findingSources()),
  };
  const original = structuredClone(input.ledger);
  const result = await collectPullRequest(input, {
    ...source,
    reviews: () => {
      called = true;
      return source.reviews();
    },
  });
  expect(result).toEqual({
    reason: "request-malformed",
    status: "invalid-request",
  });
  expect(called).toBe(false);
  expect(input.ledger).toEqual(original);
});

test("a scoped source exception produces a safe failed collection and preserves caller history", async () => {
  const input = request();
  const before = structuredClone(input.ledger);
  const secret = "private-source-response-marker";
  const result = await collectPullRequest(input, {
    ...reads(),
    scopedReviews: () => Promise.reject(new Error(secret)),
  });
  expect(result).toEqual({ reason: "read-failed", status: "unavailable" });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(input.ledger).toEqual(before);
});

test("changing to legacy history cannot reuse scoped completeness", async () => {
  const input = request();
  const first = await collectPullRequest(input, reads());
  expect(first.status).toBe("collected");
  if (first.status !== "collected") {
    throw new Error("fixture did not collect");
  }
  expect(first.ledger.reviewFindings.recorded).toBe(true);
  const { findingSources: _findingSources, ...legacy } = input;
  const second = await collectPullRequest(
    { ...legacy, ledger: first.ledger },
    reads()
  );
  expect(second.status).toBe("collected");
  if (second.status !== "collected") {
    throw new Error("fixture did not collect");
  }
  expect(second.ledger.reviewFindings.recorded).toBe(false);
  expect(second.ledger.reviewFindings.coverage).toBeUndefined();
  expect(first.ledger.reviewFindings.recorded).toBe(true);
});
