import { reviewerKey } from "./review-ledger.ts";
import type {
  ObservedRevision,
  RequiredReviewer,
  ReviewBinding,
  ReviewLedgerEntry,
} from "./review-ledger.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

/**
 * Why the ledger refused, as a fixed word a caller can act on:
 *
 * - `entry-ahead-of-clock`: the stored entry is well formed but holds a time
 *   later than the reader's `now`. The reader's clock is behind GitHub's, or
 *   the entry is corrupted or forged.
 * - `entry-invalid`: an entry, stored or handed to the store, breaks a rule.
 * - `ledger-busy`: the pull request's lock file exists.
 * - `ledger-unavailable`: the filesystem refused, or a path is not what it
 *   must be.
 * - `request-invalid`: an argument is malformed, and nothing was touched.
 */
export type ReviewLedgerErrorCode =
  | "entry-ahead-of-clock"
  | "entry-invalid"
  | "ledger-busy"
  | "ledger-unavailable"
  | "request-invalid";

/**
 * The message names a field or a file and what was expected. It never carries
 * a value from the entry, from a file or from an argument.
 */
export class ReviewLedgerError extends Error {
  readonly code: ReviewLedgerErrorCode;

  constructor(code: ReviewLedgerErrorCode, message: string) {
    super(message);
    this.name = "ReviewLedgerError";
    this.code = code;
  }
}

const fail = (path: string, expectation: string): never => {
  throw new ReviewLedgerError(
    "entry-invalid",
    `${path}: expected ${expectation}`
  );
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * A plain object read through its own enumerable fields only. One that also
 * holds a symbol or a hidden field is refused: neither would be written to the
 * file, so what was checked would not be what is stored.
 */
const record = (value: unknown, path: string): Record<string, unknown> =>
  isPlainObject(value) &&
  Reflect.ownKeys(value).length === Object.keys(value).length
    ? value
    : fail(path, "an object of plain enumerable fields");

/** A record that holds every one of `keys` and nothing else. */
const fields = (
  value: unknown,
  path: string,
  keys: readonly string[]
): Record<string, unknown> => {
  const source = record(value, path);
  const own = Object.keys(source);
  return own.length === keys.length && keys.every((key) => own.includes(key))
    ? source
    : fail(path, `exactly the fields ${keys.join(", ")}`);
};

const identifier = (value: unknown, path: string): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fail(path, "a positive integer");

const name = (value: unknown, path: string): string =>
  typeof value === "string" && value !== ""
    ? value
    : fail(path, "a nonempty string");

const commit = (value: unknown, path: string): string =>
  typeof value === "string" && /^[\da-f]{40}$/u.test(value)
    ? value
    : fail(path, "a full lowercase commit ID");

const instant = (value: unknown, path: string): string =>
  typeof value === "string" && wholeSecondUtc(value) !== null
    ? value
    : fail(path, "a whole-second UTC time");

const reviewer = (value: unknown, path: string): RequiredReviewer => {
  const { kind } = record(value, path);
  if (kind === "user") {
    const source = fields(value, path, ["id", "kind", "login"]);
    return {
      id: identifier(source.id, `${path}.id`),
      kind,
      login: name(source.login, `${path}.login`),
    };
  }
  if (kind === "team") {
    const source = fields(value, path, ["id", "kind", "slug"]);
    return {
      id: identifier(source.id, `${path}.id`),
      kind,
      slug: name(source.slug, `${path}.slug`),
    };
  }
  return fail(`${path}.kind`, '"user" or "team"');
};

/** In any order in the file; returned as `ReviewLedgerEntry` documents. */
const reviewers = (value: unknown, path: string): RequiredReviewer[] => {
  if (!Array.isArray(value)) {
    return fail(path, "an array");
  }
  const seen = new Set<string>();
  // `Array.from` visits a hole as `undefined`, where `map` would skip it.
  const parsed = Array.from(value, (item: unknown, index) => {
    const itemPath = `${path}[${index}]`;
    const result = reviewer(item, itemPath);
    if (seen.has(reviewerKey(result))) {
      fail(itemPath, "a kind and ID that no earlier reviewer has");
    }
    seen.add(reviewerKey(result));
    return result;
  });
  return parsed.toSorted(
    (left, right) =>
      Number(left.kind > right.kind) - Number(left.kind < right.kind) ||
      left.id - right.id
  );
};

const SNAPSHOT_FIELDS = ["baseSha", "headSha", "observedAt"] as const;

const revision = (
  source: Record<string, unknown>,
  path: string
): ObservedRevision => ({
  baseSha: commit(source.baseSha, `${path}.baseSha`),
  headSha: commit(source.headSha, `${path}.headSha`),
  observedAt: instant(source.observedAt, `${path}.observedAt`),
});

/**
 * `boundBase` binds only to a snapshot strictly earlier than the approval, so
 * a binding that says otherwise was never made by it.
 */
const binding = (value: unknown, path: string): ReviewBinding => {
  const source = fields(value, path, [...SNAPSHOT_FIELDS, "submittedAt"]);
  const bound = {
    ...revision(source, path),
    submittedAt: instant(source.submittedAt, `${path}.submittedAt`),
  };
  return Date.parse(bound.observedAt) < Date.parse(bound.submittedAt)
    ? bound
    : fail(`${path}.observedAt`, "a time earlier than submittedAt");
};

/** A review ID as `String` writes it: no sign, leading zero or fraction. */
const isReviewId = (key: string): boolean =>
  /^[1-9]\d*$/u.test(key) && Number.isSafeInteger(Number(key));

const bindings = (
  value: unknown,
  path: string
): Record<string, ReviewBinding> => {
  const result: Record<string, ReviewBinding> = {};
  for (const [key, item] of Object.entries(record(value, path))) {
    if (!isReviewId(key)) {
      // The key is content too, so the path stops at the object that holds it.
      fail(path, "every key to be a review ID in canonical form");
    }
    result[key] = binding(item, `${path}.${key}`);
  }
  return result;
};

/** The entry of a pull request nothing has been recorded for. */
export const emptyReviewLedgerEntry = (): ReviewLedgerEntry => ({
  observedRevision: null,
  requiredReviewers: [],
  reviewBindings: {},
});

/**
 * Reads an entry strictly, or throws `ReviewLedgerError` with `entry-invalid`.
 * The entry decides whether an approval counts and `review-ledger.ts` trusts
 * its shape, so this is the boundary where a corrupted one stops.
 *
 * It checks shape and internal consistency only. It compares no time with a
 * clock: that is `readReviewLedger`'s check, on the stored entry alone.
 *
 * The result is the entry in canonical form, reviewers sorted by kind and then
 * ID, and shares no object with `value`. It establishes the entry's shape and
 * nothing about who wrote it.
 */
export const parseReviewLedgerEntry = (value: unknown): ReviewLedgerEntry => {
  const source = fields(value, "entry", [
    "observedRevision",
    "requiredReviewers",
    "reviewBindings",
  ]);
  const snapshot = source.observedRevision;
  return {
    observedRevision:
      snapshot === null
        ? null
        : revision(
            fields(snapshot, "observedRevision", SNAPSHOT_FIELDS),
            "observedRevision"
          ),
    requiredReviewers: reviewers(source.requiredReviewers, "requiredReviewers"),
    reviewBindings: bindings(source.reviewBindings, "reviewBindings"),
  };
};
