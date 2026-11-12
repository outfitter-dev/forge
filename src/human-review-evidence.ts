import type { HumanReviewEvidence } from "./evidence-types.ts";
import { GITHUB_GHOST_LOGIN } from "./github-pull-request-types.ts";
import type {
  GitHubBaseChange,
  GitHubPullRequest,
  GitHubReview,
  GitHubReviewRequest,
} from "./github-pull-request-types.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

/**
 * A revision the trusted collector saw, and when. `observedAt` is compared
 * with GitHub's own review times, so it must be on GitHub's clock and no
 * earlier than the moment GitHub served this head and base: the `Date` header
 * of the stable read, or later. A time taken before the read, or from a clock
 * that lags GitHub, can bind an approval to a base it was not given against.
 */
export interface ObservedRevision {
  headSha: string;
  baseSha: string;
  observedAt: string;
}

/** The base one approval was bound to, and the facts that justified it. */
export interface ReviewBinding extends ObservedRevision {
  submittedAt: string;
}

/**
 * What the collector persists for one pull request between collections.
 * GitHub forgets a review request once it is answered and never records the
 * base an approval was given against, so both are kept here.
 */
export interface ReviewLedgerEntry {
  requiredReviewers: string[];
  /** Replaced by the collector after each complete, stable collection. */
  observedRevision: ObservedRevision | null;
  /** Keyed by GitHub review ID. An entry is never rebound. */
  reviewBindings: Record<string, ReviewBinding>;
}

export interface HumanReviewInput {
  repository: string;
  pullRequest: GitHubPullRequest;
  /**
   * When GitHub served `pullRequest`, on GitHub's clock. The collector must
   * read the reviews no later than the pull request, and the timeline no
   * earlier, so that no approval submitted before this time can be missing its
   * base change. An approval submitted at or after it waits for the next
   * collection.
   */
  pullRequestReadAt: string;
  requests: GitHubReviewRequest[];
  /** Every event that can come with a change of base, from the whole timeline. */
  baseChanges: GitHubBaseChange[];
  reviews: GitHubReview[];
  ledger: ReviewLedgerEntry;
}

export interface HumanReviewResult {
  assignments: { recorded: true; requiredReviewers: string[] };
  humanReviews: HumanReviewEvidence[];
  /**
   * The entry to persist if the collection is accepted, once the collector has
   * replaced `observedRevision` with the revision it just read. Until then it
   * still carries the previous snapshot. It shares no objects with the input.
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

const instant = (value: string | null): number | null =>
  value === null ? null : wholeSecondUtc(value);

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
    const time = instant(review.submittedAt);
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

/**
 * The base an approval counts against, or `null`. A new binding needs a
 * snapshot of this exact head and base persisted strictly before the approval
 * was submitted, an approval submitted before this collection read the pull
 * request, and no possible change of base since that snapshot: a base that
 * left and came back would otherwise look unchanged.
 * `bindings` gains the new binding when one is made.
 */
const boundBase = (
  review: Decision,
  input: HumanReviewInput,
  bindings: Record<string, ReviewBinding>
): string | null => {
  const key = String(review.id);
  const recorded = Object.hasOwn(bindings, key) ? bindings[key] : undefined;
  if (recorded !== undefined) {
    return recorded.headSha === review.commitId &&
      recorded.submittedAt === review.submittedAt
      ? recorded.baseSha
      : null;
  }
  const { head, base } = input.pullRequest;
  const observed = input.ledger.observedRevision;
  const submittedAt = instant(review.submittedAt);
  const observedAt = observed === null ? null : instant(observed.observedAt);
  const readAt = instant(input.pullRequestReadAt);
  if (
    observed === null ||
    observedAt === null ||
    submittedAt === null ||
    readAt === null ||
    submittedAt >= readAt ||
    review.submittedAt === null ||
    review.commitId !== head.sha ||
    observed.headSha !== head.sha ||
    observed.baseSha !== base.sha ||
    observedAt >= submittedAt ||
    input.baseChanges.some((change) => {
      const changedAt = instant(change.createdAt);
      return changedAt === null || changedAt >= observedAt;
    })
  ) {
    return null;
  }
  bindings[key] = {
    baseSha: base.sha,
    headSha: head.sha,
    observedAt: observed.observedAt,
    submittedAt: review.submittedAt,
  };
  return base.sha;
};

const requiredReviewers = (input: HumanReviewInput): string[] => {
  const required = new Set(input.ledger.requiredReviewers);
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
  for (const person of people) {
    if (person.type === "User") {
      required.add(person.login);
    }
  }
  // No rule yet says whose approval satisfies a team, so a team request
  // stays a requirement that no individual review can meet.
  for (const team of teams) {
    required.add(`team:${team.slug}`);
  }
  return [...required].toSorted(byText);
};

/**
 * Turns one pull request's review requests and reviews into the evaluator's
 * human-review evidence. Pure: it reads no clock and writes no state.
 */
export const humanReviewEvidence = (
  input: HumanReviewInput
): HumanReviewResult => {
  const required = requiredReviewers(input);
  const { observedRevision, reviewBindings } = structuredClone(input.ledger);
  const bindings = reviewBindings;
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
      const reviewer = deleted
        ? `${GITHUB_GHOST_LOGIN}#${review.id}`
        : review.author.login;
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
    assignments: { recorded: true, requiredReviewers: required },
    humanReviews,
    ledger: {
      observedRevision,
      requiredReviewers: required,
      reviewBindings: bindings,
    },
  };
};
