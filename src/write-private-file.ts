import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/**
 * Replaces `file` with `text` in one step: an exclusive owner-only temporary
 * file in the same directory, named `<file>.<random UUID>.tmp`, renamed over
 * it. A reader sees the old text or the new, and the old file is never written
 * into. Nothing is flushed to the device, so nothing is promised about what a
 * crash of the machine leaves there.
 *
 * A failure rejects with the system's own error, which can hold a path; what
 * to report is the caller's to decide. `onFailure` says what becomes of the
 * temporary file then. The two callers differ: `forge check` leaves it beside
 * the receipt, and the review ledger removes it.
 */
export const writePrivateFile = async (
  file: string,
  text: string,
  onFailure: "leave-temporary" | "remove-temporary"
): Promise<void> => {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    if (onFailure === "remove-temporary") {
      try {
        await rm(temporary, { force: true });
      } catch {
        // The failure to report is the write's, not the cleanup's.
      }
    }
    throw error;
  }
};
