import { isDeepStrictEqual } from "node:util";

import { parseCodexReviewConfiguration } from "./codex-review-configuration.ts";
import {
  collectedCodexReview,
  commentReadCapability,
  readCollectionComments,
} from "./collect-codex-review.ts";
import type {
  PullRequestCollectionFailure,
  PullRequestCollectionRequest,
  PullRequestCollectionResult,
  PullRequestReads,
  PullRequestCommentReads,
} from "./collect-pull-request-types.ts";
import {
  InvalidEvidenceError,
  choice,
  object,
  provenance,
  repository,
} from "./evidence-validation-primitives.ts";
import { GitHubReadError } from "./github-pull-request-reads.ts";
import type {
  GitHubPullRequest,
  GitHubReview,
  GitHubReviewThread,
} from "./github-pull-request-types.ts";
import {
  HumanReviewError,
  humanReviewEvidence,
} from "./human-review-evidence.ts";
import {
  GitHubResponseError,
  parseBaseChanges,
  parsePullRequest,
  parseReviewRequests,
  parseReviews,
  parseReviewThreadPage,
} from "./parse-github-pull-request.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

/** Carries a failure out of a read. It never leaves this module. */
class StoppedError extends Error {
  readonly failure: PullRequestCollectionFailure;

  constructor(failure: PullRequestCollectionFailure) {
    super(failure.reason);
    this.name = "StoppedError";
    this.failure = failure;
  }
}

const stop = (failure: PullRequestCollectionFailure): never => {
  throw new StoppedError(failure);
};

/** What a read threw may hold a token or a response, so only a fixed code is kept. */
const attempt = async <T>(read: () => Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch {
    return stop({ reason: "read-failed", status: "unavailable" });
  }
};

const positiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

/** Printable ASCII with no space at either end, so one spelling means one label. */
const HOLD_LABEL = /^[!-~](?:[ -~]*[!-~])?$/u;

/** The ledger is not checked here: rejecting a corrupted entry is for its store. */
const validRequest = (request: PullRequestCollectionRequest): boolean => {
  try {
    repository(request.repository, "repository");
    provenance(request.provenance, "provenance");
    if (Object.hasOwn(request, "codexReview")) {
      const config = object(request.codexReview, "codexReview", [
        "reviewer",
        "issuer",
        "botAccountId",
        "attestation",
        "maxCommentPages",
        "findingsComplete",
      ]);
      if (!positiveInteger(config.maxCommentPages as number)) {
        return false;
      }
      if (Object.hasOwn(config, "findingsComplete")) {
        choice(config.findingsComplete, "codexReview.findingsComplete", [
          true,
          false,
        ]);
      }
      parseCodexReviewConfiguration({
        attestation: config.attestation,
        botAccountId: config.botAccountId,
        issuer: config.issuer,
        reviewer: config.reviewer,
      });
    }
  } catch {
    return false;
  }
  return (
    typeof request.holdLabel === "string" &&
    HOLD_LABEL.test(request.holdLabel) &&
    positiveInteger(request.pullRequest) &&
    positiveInteger(request.maxThreadPages)
  );
};

/** Only `A` to `Z`: a Unicode case mapping would call the Kelvin sign a `k`. */
const foldAscii = (name: string): string =>
  name.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());

/** GitHub tells neither repository names nor label names apart by case. */
const sameName = (left: string, right: string): boolean =>
  foldAscii(left) === foldAscii(right);

const readPullRequest = async (
  reads: PullRequestReads,
  request: PullRequestCollectionRequest
): Promise<{
  pullRequest: GitHubPullRequest;
  servedAt: string;
  servedTime: number;
}> => {
  // Inside the attempt, so a read that resolves to no object is a failed read.
  const { body, servedAt } = await attempt(async () => {
    const response = await reads.pullRequest();
    return { body: response.body, servedAt: response.servedAt };
  });
  const servedTime =
    typeof servedAt === "string" ? wholeSecondUtc(servedAt) : null;
  if (servedTime === null) {
    return stop({
      path: "servedAt",
      reason: "served-at-unreadable",
      status: "unreadable",
    });
  }
  const pullRequest = parsePullRequest(body);
  if (!sameName(pullRequest.base.repositoryName, request.repository)) {
    stop({ reason: "repository-mismatch", status: "mismatch" });
  }
  if (pullRequest.number !== request.pullRequest) {
    stop({ reason: "pull-request-mismatch", status: "mismatch" });
  }
  return { pullRequest, servedAt, servedTime };
};

const readReviews = async (reads: PullRequestReads): Promise<GitHubReview[]> =>
  parseReviews(await attempt(() => reads.reviews()));

const readTimeline = async (reads: PullRequestReads) => {
  const timeline = await attempt(() => reads.timeline());
  return {
    baseChanges: parseBaseChanges(timeline),
    requests: parseReviewRequests(timeline),
  };
};

/** Every thread on every page. A repeated identity or cursor cannot establish completeness. */
const readThreads = async (
  reads: PullRequestReads,
  maxThreadPages: number
): Promise<GitHubReviewThread[]> => {
  let cursor: string | null = null;
  const threads: GitHubReviewThread[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  for (let read = 0; read < maxThreadPages; read += 1) {
    const after = cursor;
    // oxlint-disable-next-line no-await-in-loop -- Each page is asked for with the cursor the page before it returned.
    const response = await attempt(() => reads.reviewThreads(after));
    const page = parseReviewThreadPage(response);
    for (const [index, thread] of page.threads.entries()) {
      if (ids.has(thread.id)) {
        throw new GitHubResponseError(
          `threads.data.repository.pullRequest.reviewThreads.nodes[${index}].id`,
          "a unique thread ID across all pages"
        );
      }
      ids.add(thread.id);
      threads.push(thread);
    }
    if (page.nextCursor === null) {
      return threads;
    }
    if (cursors.has(page.nextCursor)) {
      throw new GitHubResponseError(
        "threads.data.repository.pullRequest.reviewThreads.pageInfo.endCursor",
        "a new pagination cursor"
      );
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return stop({ reason: "thread-pages-exceeded", status: "unavailable" });
};

/**
 * Reads one pull request's live state and returns the pull-request part of
 * the evaluator's evidence. Everything comes through `reads`: this performs no
 * network, filesystem, clock or environment access, and never writes to GitHub.
 *
 * The order of the first pass is fixed, and no two reads run at once. The
 * binding rule in `review-ledger.ts` is sound only if the reviews are read no
 * later than the pull request and the timeline no earlier: every approval in
 * hand was then submitted before the pull request was served, and every base
 * change up to that moment is in the timeline. For the same reason
 * `pullRequestReadAt` is the first pull request read's `servedAt`, never the
 * second's. See `HumanReviewInput.pullRequestReadAt`.
 *
 * The second pass reads everything again, and the collection is accepted only
 * if both passes parse to the same values. It starts with the pull request,
 * so the two reads of the reviews lie either side of both pull request reads.
 */
export const collectPullRequest = async (
  input: PullRequestCollectionRequest,
  reads: PullRequestReads & Partial<PullRequestCommentReads>
): Promise<PullRequestCollectionResult> => {
  if (!validRequest(input)) {
    return { reason: "request-malformed", status: "invalid-request" };
  }
  // Taken before any read, so nothing done to the caller's request or ledger
  // while the reads are awaited changes what is collected.
  const request = structuredClone(input);
  const commentReads = commentReadCapability(reads);
  if (request.codexReview !== undefined && commentReads === null) {
    return { reason: "comment-read-missing", status: "unavailable" };
  }
  try {
    const reviews = await readReviews(reads);
    const comments = await readCollectionComments(
      request.codexReview,
      commentReads
    );
    const { pullRequest, servedAt, servedTime } = await readPullRequest(
      reads,
      request
    );
    const timeline = await readTimeline(reads);
    const reviewThreads = await readThreads(reads, request.maxThreadPages);

    const again = await readPullRequest(reads, request);
    // GitHub's clock does not run backwards between two reads, so an earlier
    // time on the later one is a stale or cached response.
    if (again.servedTime < servedTime) {
      return {
        path: "servedAt",
        reason: "served-at-regressed",
        status: "unreadable",
      };
    }
    if (!isDeepStrictEqual(pullRequest, again.pullRequest)) {
      return { reason: "pull-request-changed", status: "changed" };
    }
    if (!isDeepStrictEqual(reviews, await readReviews(reads))) {
      return { reason: "reviews-changed", status: "changed" };
    }
    if (!isDeepStrictEqual(timeline, await readTimeline(reads))) {
      return { reason: "timeline-changed", status: "changed" };
    }
    const threadsAgain = await readThreads(reads, request.maxThreadPages);
    if (!isDeepStrictEqual(reviewThreads, threadsAgain)) {
      return { reason: "threads-changed", status: "changed" };
    }

    const commentsAgain = await readCollectionComments(
      request.codexReview,
      commentReads
    );
    if (!isDeepStrictEqual(comments, commentsAgain)) {
      return { reason: "comments-changed", status: "changed" };
    }

    const { assignments, humanReviews, ledger } = humanReviewEvidence({
      ...timeline,
      ledger: request.ledger,
      pullRequest,
      pullRequestReadAt: servedAt,
      repository: request.repository,
      reviews,
    });
    const subject = {
      baseSha: pullRequest.base.sha,
      headSha: pullRequest.head.sha,
      id: pullRequest.number,
      kind: "pull_request" as const,
      repository: request.repository,
    };
    const codexReview = collectedCodexReview(request.codexReview, comments, {
      ledger,
      reviewThreads,
      servedAt,
      subject,
    });
    if (codexReview !== undefined) {
      ledger.reviewFindings = structuredClone(codexReview.reviewFindings);
    }
    return {
      evidence: {
        assignments,
        draft: pullRequest.draft,
        humanReviews,
        // The part of an authorization rule GitHub shows: the head branch is in
        // the base repository, which takes push access there, and is not held.
        mergeAuthorized:
          pullRequest.head.repositoryId === pullRequest.base.repositoryId &&
          !pullRequest.labels.some((label) =>
            sameName(label.name, request.holdLabel)
          ),
        mergeable: pullRequest.mergeable,
        open: pullRequest.state === "open",
        provenance: request.provenance,
        subject,
        unresolvedThreads: reviewThreads.filter((thread) => !thread.isResolved)
          .length,
      },
      ...(codexReview === undefined ? {} : { codexReview }),
      ledger,
      reviewThreads,
      status: "collected",
    };
  } catch (error) {
    if (error instanceof StoppedError) {
      return error.failure;
    }
    // Every read is wrapped by `attempt`, so these two come only from the
    // parsers and the review rules, never from a caller's read.
    if (error instanceof GitHubResponseError) {
      return {
        path: error.path,
        reason: "response-unreadable",
        status: "unreadable",
      };
    }
    if (error instanceof GitHubReadError) {
      return {
        reason:
          error.code === "pages-exceeded"
            ? "comment-pages-exceeded"
            : "read-failed",
        status: "unavailable",
      };
    }
    if (error instanceof InvalidEvidenceError) {
      return {
        path: "codexReview",
        reason: "codex-evidence-unreadable",
        status: "unreadable",
      };
    }
    if (error instanceof HumanReviewError) {
      return { reason: "review-history-ambiguous", status: "ambiguous" };
    }
    throw error;
  }
};
