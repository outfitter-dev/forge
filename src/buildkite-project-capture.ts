import { spawn } from "node:child_process";
import { renameSync } from "node:fs";
import { mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildkiteUuid, fullCommit } from "./buildkite-job.ts";
import { BUILDKITE_MAX_RECEIPT_BYTES } from "./buildkite-project-receipt.ts";
import type { BuildkiteProjectCapture } from "./buildkite-project-receipt.ts";
import { digest } from "./check-config.ts";

export interface BuildkiteProjectLaunch {
  jobId: string;
  repository: string;
  head: string;
  base: string;
  projectRoot: string;
  captureRoot: string;
  /** Protected wrapper that establishes the project account and isolation. */
  launcher: string;
  /** Compiled project-check executable from the approved install. */
  runner: string;
  toolBin: string;
  timeoutMs: number;
}

type CaptureResult =
  | {
      status: "captured";
      capture: BuildkiteProjectCapture;
      receiptFile: string;
    }
  | {
      status: "not-captured";
      reason:
        | "invalid-input"
        | "store-unavailable"
        | "launch-failed"
        | "output-limit"
        | "deadline"
        | "runner-signaled"
        | "canceled";
    };

const within = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

const validLaunch = (input: BuildkiteProjectLaunch): boolean =>
  !(
    !buildkiteUuid(input.jobId) ||
    !fullCommit(input.head) ||
    !fullCommit(input.base) ||
    !/^[\w.-]+\/[\w.-]+$/u.test(input.repository) ||
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 3_600_000 ||
    ![
      input.projectRoot,
      input.captureRoot,
      input.launcher,
      input.runner,
      input.toolBin,
    ].every(
      (value) =>
        path.isAbsolute(value) &&
        ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32)
    )
  );

/** Host-owned launch and stdout capture. The wrapper owns identity and isolation. */
export const captureBuildkiteProjectCheck = async (
  input: BuildkiteProjectLaunch,
  signal?: AbortSignal
): Promise<CaptureResult> => {
  if (!validLaunch(input)) {
    return { reason: "invalid-input", status: "not-captured" };
  }
  let directory: string;
  try {
    const project = await realpath(input.projectRoot);
    const store = await realpath(input.captureRoot);
    const mode = await stat(store);
    if (
      !mode.isDirectory() ||
      // oxlint-disable-next-line eslint/no-bitwise
      (mode.mode & 0o077) !== 0 ||
      mode.uid !== process.getuid?.()
    ) {
      return { reason: "store-unavailable", status: "not-captured" };
    }
    if (
      within(project, store) ||
      within(project, await realpath(input.runner)) ||
      within(project, await realpath(input.launcher)) ||
      within(project, await realpath(input.toolBin))
    ) {
      return { reason: "invalid-input", status: "not-captured" };
    }
    directory = path.join(store, input.jobId);
    // An attempt gets one capture. Never overwrite a prior attempt's record.
    await mkdir(directory, { mode: 0o700 });
  } catch {
    return { reason: "store-unavailable", status: "not-captured" };
  }
  // Node process events resolve after stdout closes, including descendants.
  // oxlint-disable-next-line promise/avoid-new
  const output = await new Promise<
    | { bytes: Uint8Array; code: number }
    | {
        reason:
          | "launch-failed"
          | "output-limit"
          | "deadline"
          | "runner-signaled"
          | "canceled";
      }
  >((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let reason: "output-limit" | "deadline" | "canceled" | null = null;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(
      input.launcher,
      [input.runner, input.repository, input.head, input.base, input.toolBin],
      {
        cwd: input.projectRoot,
        detached: true,
        env: {},
        stdio: ["ignore", "pipe", "inherit"],
      }
    );
    const kill = (value: NodeJS.Signals) => {
      try {
        if (child.pid) {
          process.kill(-child.pid, value);
        }
      } catch {
        // An already exited process group is normal.
      }
    };
    const stop = (cause: "output-limit" | "deadline" | "canceled") => {
      if (reason) {
        return;
      }
      reason = cause;
      // The compiled runner forwards TERM to the check's own process group.
      kill("SIGTERM");
      escalation = setTimeout(() => {
        kill("SIGKILL");
        child.stdout.destroy();
      }, 5000);
    };
    const cancel = () => stop("canceled");
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => stop("deadline"), input.timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(escalation);
      signal?.removeEventListener("abort", cancel);
    };
    if (signal?.aborted) {
      cancel();
    }
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BUILDKITE_MAX_RECEIPT_BYTES) {
        stop("output-limit");
      } else if (!reason) {
        chunks.push(chunk);
      }
    });
    child.on("error", () => {
      cleanup();
      resolve({ reason: "launch-failed" });
    });
    child.on("close", (code) => {
      cleanup();
      if (reason) {
        resolve({ reason });
      } else if (code === null) {
        resolve({ reason: "runner-signaled" });
      } else {
        resolve({ bytes: Buffer.concat(chunks), code });
      }
    });
  });
  if ("reason" in output) {
    await rm(directory, { force: true, recursive: true });
    return { reason: output.reason, status: "not-captured" };
  }
  if (signal?.aborted) {
    await rm(directory, { force: true, recursive: true });
    return { reason: "canceled", status: "not-captured" };
  }
  const capture: BuildkiteProjectCapture = {
    jobId: input.jobId,
    receiptSha256: digest(output.bytes),
    runnerExitCode: output.code,
  };
  const receiptFile = path.join(directory, "receipt.json");
  try {
    // Receipts are UTF-8 JSON stdout, and publication preserves every byte.
    await writeFile(receiptFile, output.bytes, { flag: "wx", mode: 0o600 });
    const pending = path.join(directory, "capture.pending");
    await writeFile(pending, JSON.stringify(capture), {
      flag: "wx",
      mode: 0o600,
    });
    if (signal?.aborted) {
      await rm(directory, { force: true, recursive: true });
      return { reason: "canceled", status: "not-captured" };
    }
    // Commit point: no event-loop turn can deliver cancellation between this
    // final check and publication. A later abort cannot retract a visible record.
    renameSync(pending, path.join(directory, "capture.json"));
    return { capture, receiptFile, status: "captured" };
  } catch {
    await rm(directory, { force: true, recursive: true });
    return { reason: "store-unavailable", status: "not-captured" };
  }
};
