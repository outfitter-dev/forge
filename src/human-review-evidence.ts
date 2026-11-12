import type { HumanReviewEvidence } from "./evidence-types.ts";
import { GITHUB_GHOST_LOGIN } from "./github-pull-request-types.ts";
import type {
  GitHubActor,
  GitHubBaseChange,
  GitHubPullRequest,
  GitHubReview,
  GitHubReviewRequest,
} from "./github-pull-request-types.ts";
import {
  boundBase,
  nextSnapshot,
  reviewerKey,
  reviewerLabel,
  reviewerNaming,
} from "./review-ledger.ts";
import type { RequiredReviewer, ReviewLedgerEntry } from "./review-ledger.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

export interface HumanReviewInput {
  repository: string;
  pullRequest: GitHubPullRequest;
  /**
   * When GitHub served `pullRequest`, on GitHub's clock: the `Date` header of
   * that response, not a local clock and not a later time. It is compared with
   * GitHub's own review and event times, so a time taken before the read, or
   * from a clock that lags GitHub, can bind an approval to a base it was not
   * given against. The collector must read the reviews no later than the pull
   * request, and the timeline no earlier, so that no approval submitted before
   * this time can be missing its base change. An approval submitted at or
   * after it is left for a later collection to bind, with one exception: an
   * approval submitted in the same second as a read that records a new
   * snapshot never binds. A read records one at the first sight of this head
   * and base, at the first read after a possible change of base, and when the
   * stored one has no readable time. Its time becomes the snapshot's, the
   * approval shares that second, and the rule needs the snapshot to be
   * strictly earlier. The reviewer has to approve again.
   */
  pullRequestReadAt: string;
  requests: GitHubReviewRequest[];
  /** Every event that can come with a change of base, from the whole timeline. */
  baseChanges: GitHubBaseChange[];
  reviews: GitHubReview[];
  ledger: ReviewLedgerEntry;
}

export interface HumanReviewResult {
  /**
   * These and each review's `reviewer` are `reviewerLabel` strings, except
   * that a deleted account's review is `ghost#<review ID>`.
   */
  assignments: { recorded: true; requiredReviewers: string[] };
  humanReviews: HumanReviewEvidence[];
  /**
   * The entry to persist, as it is, if the collection is accepted. It shares
   * no objects with the input.
   */
  ledger: ReviewLedgerEntry;
}

/** The review history is ambiguous. Collection must stop, not guess. */
export class HumanReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HumanReviewError";
  }
}

type Decision = GitHubReview & {
  state: "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED";
};

const isDecision = (review: GitHubReview): review is Decision =>
  review.state === "APPROVED" ||
  review.state === "CHANGES_REQUESTED" ||
  review.state === "DISMISSED";

const byText = (left: string, right: string): number =>
  Number(left > right) - Number(left < right);

const BLOCKING = { APPROVED: 0, CHANGES_REQUESTED: 2, DISMISSED: 1 } as const;

/** Among decisions submitted together: the more blocking, then the higher ID. */
const outranks = (review: Decision, chosen: Decision): boolean => {
  const rank = BLOCKING[review.state] - BLOCKING[chosen.state];
  return rank === 0 ? review.id > chosen.id : rank > 0;
};

/**
 * The decision submitted last. Review IDs are allocated when a pending review
 * is created, so they do not order decisions. At the same instant a blocking
 * decision wins over an approval.
 */
const latestDecision = (decisions: Decision[]): Decision => {
  const timed = decisions.map((review) => {
    const time =
      review.submittedAt === null ? null : wholeSecondUtc(review.submittedAt);
    if (time === null) {
      throw new HumanReviewError(
        "a review decision has no readable submission time"
      );
    }
    return { review, time };
  });
  const last = Math.max(...timed.map((item) => item.time));
  const latest = timed
    .filter((item) => item.time === last)
    .map((item) => item.review);
  const blocked = latest.some((review) => review.state !== "APPROVED");
  if (!blocked && new Set(latest.map((review) => review.commitId)).size > 1) {
    throw new HumanReviewError(
      "approvals submitted at the same time name different commits"
    );
  }
  let chosen: Decision | null = null;
  for (const review of latest) {
    if (chosen === null || outranks(review, chosen)) {
      chosen = review;
    }
  }
  if (chosen === null) {
    throw new HumanReviewError("a reviewer has no decision to weigh");
  }
  return chosen;
};

/**
 * One reviewer's standing decision. A dismissal clears only the review that
 * was dismissed: GitHub does not say what that review was, so a change request
 * the reviewer made and nobody dismissed still stands behind it.
 */
const standing = (decisions: Decision[]): Decision => {
  const latest = latestDecision(decisions);
  const objections = decisions.filter(
    (review) => review.state === "CHANGES_REQUESTED"
  );
  return latest.state === "DISMISSED" && objections.length > 0
    ? latestDecision(objections)
    : latest;
};

const person = (actor: GitHubActor): RequiredReviewer => ({
  id: actor.id,
  kind: "user",
  login: actor.login,
});

/** Everyone this collection shows as asked to review, as GitHub names them now. */
const requested = (input: HumanReviewInput): RequiredReviewer[] => {
  const people = [
    ...input.pullRequest.requestedReviewers,
    ...input.requests.flatMap((item) =>
      item.kind === "user" ? [item.reviewer] : []
    ),
  ];
  const teams = [
    ...input.pullRequest.requestedTeams,
    ...input.requests.flatMap((item) =>
      item.kind === "team" ? [item.team] : []
    ),
  ];
  return [
    ...people.filter((actor) => actor.type === "User").map(person),
    // No rule yet says whose approval satisfies a team, so a team request
    // stays a requirement that no individual review can meet.
    ...teams.map((team): RequiredReviewer => ({
      id: team.id,
      kind: "team",
      slug: team.slug,
    })),
  ];
};

/**
 * Turns one pull request's review requests and reviews into the evaluator's
 * human-review evidence. Pure: it reads no clock and writes no state.
 */
export const humanReviewEvidence = (
  input: HumanReviewInput
): HumanReviewResult => {
  const asked = requested(input);
  // Review authors are named too, so a requirement kept only in the ledger
  // and a review by that account under a new login get one label.
  const named = reviewerNaming([
    ...asked,
    ...input.reviews.map((review) => person(review.author)),
  ]);
  const required = new Map<string, RequiredReviewer>();
  for (const reviewer of [...input.ledger.requiredReviewers, ...asked]) {
    required.set(reviewerKey(reviewer), named(reviewer));
  }
  const requiredReviewers = [...required.values()].toSorted(
    (left, right) => byText(left.kind, right.kind) || left.id - right.id
  );
  const bindings = structuredClone(input.ledger.reviewBindings);
  const byReviewer = new Map<string, Decision[]>();
  for (const review of input.reviews) {
    // Every deleted account shares one identity, so its reviews cannot be
    // grouped into one reviewer or recognised as the author's own.
    const deleted = review.author.login === GITHUB_GHOST_LOGIN;
    if (
      isDecision(review) &&
      review.author.type === "User" &&
      (deleted || review.author.id !== input.pullRequest.author.id)
    ) {
      // A label holds the account ID, so grouping by it groups by account.
      const reviewer = deleted
        ? `${GITHUB_GHOST_LOGIN}#${review.id}`
        : reviewerLabel(named(person(review.author)));
      const decisions = byReviewer.get(reviewer) ?? [];
      decisions.push(review);
      byReviewer.set(reviewer, decisions);
    }
  }
  const humanReviews = [...byReviewer.keys()]
    .toSorted(byText)
    .map((reviewer): HumanReviewEvidence => {
      const review = standing(byReviewer.get(reviewer) ?? []);
      if (review.state !== "APPROVED") {
        const state =
          review.state === "DISMISSED" ? "dismissed" : "changes_requested";
        return { reviewer, state, subject: null };
      }
      // An approval nobody can be held to is recorded and never bound.
      const baseSha =
        review.author.login === GITHUB_GHOST_LOGIN
          ? null
          : boundBase(review, input, bindings);
      return {
        reviewer,
        state: "approved",
        subject:
          baseSha === null || review.commitId === null
            ? null
            : {
                baseSha,
                headSha: review.commitId,
                id: input.pullRequest.number,
                kind: "pull_request",
                repository: input.repository,
              },
      };
    });
  return {
    assignments: {
      recorded: true,
      requiredReviewers: requiredReviewers.map(reviewerLabel).toSorted(byText),
    },
    humanReviews,
    ledger: {
      observedRevision: nextSnapshot(input),
      requiredReviewers,
      reviewBindings: bindings,
    },
  };
};
