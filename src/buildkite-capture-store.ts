/* oxlint-disable eslint/no-bitwise -- POSIX permissions and open flags */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { buildkiteUuid } from "./buildkite-job.ts";
import type { BuildkiteProjectCapture } from "./buildkite-project-receipt.ts";
import { isLowerHexDigest } from "./evidence-validation-primitives.ts";
import { isRecord } from "./github-response.ts";

const parseCapture = (
  capture: unknown,
  jobId: string
): BuildkiteProjectCapture | null => {
  if (
    !isRecord(capture) ||
    capture.jobId !== jobId ||
    !isLowerHexDigest(capture.receiptSha256, 64) ||
    !Number.isSafeInteger(capture.runnerExitCode) ||
    typeof capture.runnerExitCode !== "number" ||
    capture.runnerExitCode < 0 ||
    capture.runnerExitCode > 255
  ) {
    return null;
  }
  return {
    jobId,
    receiptSha256: capture.receiptSha256,
    runnerExitCode: capture.runnerExitCode,
  };
};

/** Host custody is a prerequisite; file shape and modes cannot establish it. */
export const readBuildkiteProjectCapture = async (
  root: string,
  jobId: string
): Promise<BuildkiteProjectCapture | null> => {
  if (!path.isAbsolute(root) || !buildkiteUuid(jobId)) {
    return null;
  }
  try {
    const store = await realpath(root);
    const directory = path.join(store, jobId);
    const directories = await Promise.all(
      [store, directory].map((entry) => lstat(entry))
    );
    if (
      directories.some(
        (info) =>
          !info.isDirectory() ||
          info.uid !== process.getuid?.() ||
          (info.mode & 0o077) !== 0
      )
    ) {
      return null;
    }
    // oxlint-disable-next-line no-bitwise -- open flags are a bit set
    const file = await open(
      path.join(directory, "capture.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const info = await file.stat();
      // oxlint-disable-next-line no-bitwise -- POSIX permission bits
      if (
        !info.isFile() ||
        info.size > 4096 ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o077) !== 0
      ) {
        return null;
      }
      const bytes = new Uint8Array(4097);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 4096) {
        return null;
      }
      const capture: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, bytesRead)
        )
      );
      return parseCapture(capture, jobId);
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
};
