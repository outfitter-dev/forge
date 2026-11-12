import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { repository as repositoryRule } from "./evidence-validation-primitives.ts";
import { ReviewLedgerError } from "./review-ledger-entry.ts";

/**
 * The files behind `review-ledger-store.ts`: where an entry is, how its bytes
 * are read without following a symlink, and how they are replaced in one step.
 * Nothing here knows what an entry holds.
 */

/** Which pull request's entry, and where the entries are kept. */
export interface ReviewLedgerLocation {
  /**
   * Absolute path of the state directory. The caller chooses it: outside any
   * checkout and never inside a job workspace. It must not itself be a symlink.
   */
  directory: string;
  /** `owner/name`. Case does not tell two repositories apart. */
  repository: string;
  /** The pull request number, a positive integer. */
  pullRequest: number;
}

export const refuse = (
  code: ReviewLedgerError["code"],
  message: string
): never => {
  throw new ReviewLedgerError(code, message);
};

/** The system's name for a filesystem failure, such as `ENOENT`, or `null`. */
export const errno = (error: unknown): string | null =>
  error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : null;

/** Names what failed and the system's word for why, never a path or content. */
export const unavailable = (action: string, error: unknown): never =>
  refuse(
    "ledger-unavailable",
    `could not ${action}: ${errno(error) ?? "unknown failure"}`
  );

/**
 * Where one pull request's entry and lock are. Both names are
 * `<owner>+<name>+<number>` and a suffix, with the repository in lower case.
 * An owner and a name hold only letters, digits, `_`, `.` and `-`, so neither
 * a `+` nor a separator can come from them: the name is a single file directly
 * inside the directory, and two repositories or numbers never share one.
 */
export const locate = (options: ReviewLedgerLocation) => {
  const { directory, pullRequest, repository } = options;
  if (!path.isAbsolute(directory)) {
    refuse("request-invalid", "directory: expected an absolute path");
  }
  if (!Number.isSafeInteger(pullRequest) || pullRequest <= 0) {
    refuse("request-invalid", "pullRequest: expected a positive integer");
  }
  try {
    repositoryRule(repository, "repository");
  } catch {
    refuse("request-invalid", "repository: expected owner/name");
  }
  const segments = repository.toLowerCase().split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    refuse("request-invalid", "repository: expected owner/name");
  }
  const stem = `${segments.join("+")}+${pullRequest}`;
  // Resolving drops a trailing separator, which would look through a symlink.
  const root = path.resolve(directory);
  return {
    directory: root,
    entry: path.join(root, `${stem}.json`),
    lock: path.join(root, `${stem}.lock`),
    lockName: `${stem}.lock`,
  };
};

/** Whether the state directory exists. One that is a symlink is refused. */
export const directoryExists = async (directory: string): Promise<boolean> => {
  let isDirectory = false;
  try {
    const info = await lstat(directory);
    isDirectory = info.isDirectory();
  } catch (error) {
    return errno(error) === "ENOENT"
      ? false
      : unavailable("inspect the state directory", error);
  }
  if (!isDirectory) {
    refuse(
      "ledger-unavailable",
      "the state directory is a symlink or not a directory"
    );
  }
  return true;
};

/** The bytes of the regular file at `file`, or `null` when nothing is there. */
export const storedBytes = async (file: string): Promise<Uint8Array | null> => {
  let isFile = false;
  try {
    // Without following a symlink: the open itself fails on one.
    // oxlint-disable-next-line no-bitwise -- open flags are a bit set
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      isFile = info.isFile();
      if (isFile) {
        return await handle.readFile();
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Only a missing file is an empty entry. Anything else that cannot be
    // read may hold requirements and bindings, and must not be dropped.
    return errno(error) === "ENOENT"
      ? null
      : unavailable("read the entry", error);
  }
  return refuse("ledger-unavailable", "the entry is not a regular file");
};

/**
 * Replaces the file in one step: an exclusive owner-only temporary file in
 * the same directory, renamed over it. A reader sees the old text or the new.
 * Nothing is flushed to the device, so nothing is promised about what a crash
 * of the machine leaves there.
 */
export const publish = async (file: string, text: string): Promise<void> => {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    try {
      await rm(temporary, { force: true });
    } catch {
      // The failure to report is the write's, not the cleanup's.
    }
    unavailable("write the entry", error);
  }
};
