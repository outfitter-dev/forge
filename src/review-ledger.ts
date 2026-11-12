import type {
  GitHubBaseChange,
  GitHubPullRequest,
  GitHubReview,
} from "./github-pull-request-types.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

/**
 * A revision GitHub served, and when: `observedAt` is the `pullRequestReadAt`
 * of the collection that first saw this head and base. It is kept, not
 * refreshed, for as long as the head and base stay the same and nothing that
 * can change the base has happened since.
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
 * A person or team whose review was requested. `id` is the key: a login or a
 * slug can change and can pass to someone else, so `login` and `slug` are only
 * the name GitHub last gave, kept for the label.
 */
export type RequiredReviewer =
  | { kind: "user"; id: number; login: string }
  | { kind: "team"; id: number; slug: string };

/**
 * What the collector persists for one pull request between collections.
 * GitHub forgets a review request once it is answered and never records the
 * base an approval was given against, so both are kept here.
 */
export interface ReviewLedgerEntry {
  /** Unique by kind and ID, sorted by kind and then ID. */
  requiredReviewers: RequiredReviewer[];
  /** Maintained by `humanReviewEvidence`; the collector only persists it. */
  observedRevision: ObservedRevision | null;
  /** Keyed by GitHub review ID. An entry is never rebound. */
  reviewBindings: Record<string, ReviewBinding>;
}

/**
 * What the ledger rules read from one collection. `HumanReviewInput` has these
 * fields and documents them; they are named here so that this module does not
 * depend on the one that assembles the evidence.
 */
export interface LedgerInput {
  pullRequest: GitHubPullRequest;
  pullRequestReadAt: string;
  baseChanges: GitHubBaseChange[];
  ledger: ReviewLedgerEntry;
}

/** People and teams are numbered separately, so the kind is part of the key. */
export const reviewerKey = (reviewer: RequiredReviewer): string =>
  `${reviewer.kind}:${reviewer.id}`;

/**
 * The string the evaluator matches a requirement and a review by. It is a
 * label to show, not a key to store. Every label ends with the key, as
 * `(<kind> <id>)`, and a kind and an ID hold no parenthesis, so the last one
 * opened in a label always opens the key. Two different keys therefore never
 * share a label, whatever the names contain: no name can imitate another
 * account, or a person a team with the same number.
 */
export const reviewerLabel = (reviewer: RequiredReviewer): string => {
  const name = reviewer.kind === "user" ? reviewer.login : reviewer.slug;
  return `${name} (${reviewer.kind} ${reviewer.id})`;
};

/**
 * The one name each account and team goes by in a collection, so that a
 * requirement and a review by the same account get the same label. Whoever
 * the collection saw takes the name it was seen under, in place of the
 * ledger's last known one; anyone else keeps the name given. If one collection
 * names an ID two ways, which a rename between its reads can do, the label
 * that sorts first is used: both name the same account, and the choice must
 * not depend on the order the inputs arrive in. The result is a new object.
 */
export const reviewerNaming = (seen: RequiredReviewer[]) => {
  const current = new Map<string, RequiredReviewer>();
  for (const item of seen) {
    const known = current.get(reviewerKey(item));
    if (known === undefined || reviewerLabel(item) < reviewerLabel(known)) {
      current.set(reviewerKey(item), item);
    }
  }
  return (reviewer: RequiredReviewer): RequiredReviewer => ({
    ...(current.get(reviewerKey(reviewer)) ?? reviewer),
  });
};

const instant = (value: string | null): number | null =>
  value === null ? null : wholeSecondUtc(value);

/** Whether anything that can change the base happened at or after `time`. */
const baseMayHaveChangedSince = (input: LedgerInput, time: number): boolean =>
  input.baseChanges.some((change) => {
    const changedAt = instant(change.createdAt);
    return changedAt === null || changedAt >= time;
  });

/**
 * The snapshot to keep for the next collection. An existing snapshot stays
 * while it still describes the head and base and the base cannot have changed
 * since: refreshing it on every collection would put it later than an approval
 * submitted during that collection, and that approval could then never bind.
 * Otherwise the revision just read becomes the snapshot, at the read time.
 *
 * A snapshot later than this read stays as well. Replacing it would trust the
 * read time over the snapshot, and a read time that is wrong and early would
 * then move the snapshot back and let an approval bind to a base it was not
 * given against. While the snapshot is later than the read nothing binds, and
 * that ends by itself once a read passes the snapshot's time. A snapshot far
 * in the future is a corrupted entry: rejecting it is for the ledger store,
 * when it reads the entry, and nothing here does.
 */
export const nextSnapshot = (input: LedgerInput): ObservedRevision | null => {
  const { head, base } = input.pullRequest;
  const current = input.ledger.observedRevision;
  const currentAt = current === null ? null : instant(current.observedAt);
  if (
    current !== null &&
    currentAt !== null &&
    current.headSha === head.sha &&
    current.baseSha === base.sha &&
    !baseMayHaveChangedSince(input, currentAt)
  ) {
    return { ...current };
  }
  return instant(input.pullRequestReadAt) === null
    ? null
    : {
        baseSha: base.sha,
        headSha: head.sha,
        observedAt: input.pullRequestReadAt,
      };
};

/**
 * The base an approval counts against, or `null`. A new binding needs a
 * snapshot of this exact head and base persisted strictly before the approval
 * was submitted, an approval submitted before this collection read the pull
 * request, and no possible change of base since that snapshot: a base that
 * left and came back would otherwise look unchanged.
 * `bindings` gains the new binding when one is made.
 */
export const boundBase = (
  review: GitHubReview,
  input: LedgerInput,
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
    baseMayHaveChangedSince(input, observedAt)
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
