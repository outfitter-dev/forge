import { mkdir, rm, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import {
  emptyReviewLedgerEntry,
  parseReviewLedgerEntry,
  ReviewLedgerError,
} from "./review-ledger-entry.ts";
import {
  directoryExists,
  errno,
  locate,
  publish,
  refuse,
  storedBytes,
  unavailable,
} from "./review-ledger-files.ts";
import type { ReviewLedgerLocation } from "./review-ledger-files.ts";
import type { ReviewLedgerEntry } from "./review-ledger.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

export type { ReviewLedgerLocation } from "./review-ledger-files.ts";

export interface ReviewLedgerReadOptions extends ReviewLedgerLocation {
  /**
   * The time of this read as a whole-second UTC time, from a clock the caller
   * trusts. The stored entry's times are GitHub's and must not be later.
   */
  now: string;
}

const checked = (
  value: unknown,
  origin: "stored entry" | "expected entry" | "new entry"
): ReviewLedgerEntry => {
  try {
    return parseReviewLedgerEntry(value);
  } catch (error) {
    throw error instanceof ReviewLedgerError
      ? new ReviewLedgerError(error.code, `${origin}: ${error.message}`)
      : error;
  }
};

/** The stored entry in canonical form; the empty entry when there is no file. */
const current = async (file: string): Promise<ReviewLedgerEntry> => {
  const bytes = await storedBytes(file);
  if (bytes === null) {
    return emptyReviewLedgerEntry();
  }
  let value: unknown = null;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // A parser's message quotes the text it failed on.
    refuse("entry-invalid", "stored entry: expected UTF-8 JSON");
  }
  return checked(value, "stored entry");
};

/**
 * The one check against a clock, kept apart from the validator. The entry's
 * times are GitHub's and `now` is the reader's, so a time later than `now`
 * means that the reader's clock is behind or that the entry is not genuine.
 */
const refuseAhead = (entry: ReviewLedgerEntry, now: number): void => {
  const times = new Map<string, string>();
  if (entry.observedRevision !== null) {
    times.set("observedRevision.observedAt", entry.observedRevision.observedAt);
  }
  for (const [id, bound] of Object.entries(entry.reviewBindings)) {
    times.set(`reviewBindings.${id}.observedAt`, bound.observedAt);
    times.set(`reviewBindings.${id}.submittedAt`, bound.submittedAt);
  }
  for (const [field, time] of times) {
    if (Date.parse(time) > now) {
      refuse("entry-ahead-of-clock", `stored entry: ${field}: later than now`);
    }
  }
};

/**
 * Reads one pull request's stored entry. It takes no lock and creates nothing.
 * A missing file is the empty entry. A file that cannot be read, is a symlink,
 * is not JSON or breaks a rule throws, and is never treated as empty.
 *
 * @throws {ReviewLedgerError} With `entry-ahead-of-clock` when the entry is
 *   well formed but holds a time later than `now`; a time equal to it passes.
 */
export const readReviewLedger = async (
  options: ReviewLedgerReadOptions
): Promise<ReviewLedgerEntry> => {
  const files = locate(options);
  const now = wholeSecondUtc(options.now);
  if (now === null) {
    return refuse("request-invalid", "now: expected a whole-second UTC time");
  }
  if (!(await directoryExists(files.directory))) {
    return emptyReviewLedgerEntry();
  }
  const entry = await current(files.entry);
  refuseAhead(entry, now);
  return entry;
};

/**
 * Stores `next` only if the file still holds `expected`, the entry the caller
 * read before it collected. `"conflict"` means another collection stored an
 * entry in between: nothing was written, and the caller must collect again
 * from a fresh read. Entries are compared in canonical form, so order and
 * object identity do not matter.
 *
 * The lock is a file created exclusively and held only for the read, the
 * comparison and the write; no caller code runs under it. There is no waiting
 * and no taking over: a lock left by a process that stopped blocks this pull
 * request until someone removes it. See `docs/review-ledger-store.md`.
 *
 * `next` is checked for shape and consistency and against no clock. Neither
 * operation authenticates the file: whoever can write the directory can write
 * an entry this accepts.
 *
 * @throws {ReviewLedgerError} With `ledger-busy` when the lock file exists.
 */
export const replaceReviewLedger = async (
  options: ReviewLedgerLocation,
  expected: ReviewLedgerEntry,
  next: ReviewLedgerEntry
): Promise<"stored" | "conflict"> => {
  const files = locate(options);
  const wanted = checked(expected, "expected entry");
  const replacement = checked(next, "new entry");
  try {
    await mkdir(files.directory, { mode: 0o700, recursive: true });
  } catch (error) {
    unavailable("create the state directory", error);
  }
  await directoryExists(files.directory);
  try {
    // Exclusive creation fails on anything at that name, a symlink included.
    await writeFile(files.lock, "", { flag: "wx", mode: 0o600 });
  } catch (error) {
    return errno(error) === "EEXIST"
      ? refuse(
          "ledger-busy",
          `${files.lockName} exists: another replace holds it, or one that stopped left it behind`
        )
      : unavailable("take the lock", error);
  }
  try {
    if (!isDeepStrictEqual(await current(files.entry), wanted)) {
      return "conflict";
    }
    await publish(files.entry, `${JSON.stringify(replacement)}\n`);
    return "stored";
  } finally {
    await rm(files.lock, { force: true });
  }
};
