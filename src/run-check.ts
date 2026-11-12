import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { digest, readConfig } from "./check-config.ts";
import { git, observeSource } from "./check-source.ts";
import type { CheckReceipt } from "./check-types.ts";
import { writePrivateFile } from "./write-private-file.ts";

// A publication that fails leaves its temporary file in the receipt directory.
const persist = async (file: string, receipt: CheckReceipt): Promise<void> => {
  await writePrivateFile(
    file,
    `${JSON.stringify(receipt)}\n`,
    "leave-temporary"
  );
};

const execute = (
  root: string,
  command: string[],
  receipt: CheckReceipt
): Promise<void> =>
  // Child process events have no native promise completion API.
  // oxlint-disable-next-line promise/avoid-new
  new Promise((resolve) => {
    const [executable, ...args] = command;
    if (!executable) {
      resolve();
      return;
    }
    // This is project code under the caller's authority, not a sandbox. No
    // privileged orchestration credentials may be supplied by the caller.
    const child = spawn(executable, args, {
      cwd: root,
      detached: true,
      stdio: ["ignore", 2, 2],
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          // Completion below is authoritative; an already exited group is normal.
        }
      }
    };
    const cancel = (signal: "SIGINT" | "SIGTERM") => {
      receipt.cancellation = signal;
      kill(signal);
      timer ??= setTimeout(() => kill("SIGKILL"), 2000);
    };
    const interrupt = () => cancel("SIGINT");
    const terminate = () => cancel("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.once("spawn", () => {
      receipt.admission = "started";
    });
    child.once("error", () => {
      receipt.admission = "not-started";
      receipt.outcome = "not-run";
      receipt.diagnostic = "command-start-failed";
    });
    child.once("close", (code, signal) => {
      // A leader can exit while same-group descendants ignore cancellation.
      // Terminate those descendants before retiring the escalation timer.
      if (receipt.cancellation) {
        kill("SIGKILL");
      }
      clearTimeout(timer);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      receipt.completion = "observed";
      receipt.exitCode = receipt.admission === "started" ? code : null;
      receipt.signal = signal;
      if (receipt.cancellation) {
        receipt.outcome = "canceled";
        receipt.diagnostic = "command-canceled";
      } else if (receipt.admission === "started") {
        receipt.outcome = code === 0 ? "passed" : "failed";
        receipt.diagnostic =
          code === 0 ? "command-passed" : "command-failed-unclassified";
      }
      resolve();
    });
  });

export const receiptExitCode = (receipt: CheckReceipt): number => {
  if (receipt.recording.state === "failed") {
    return 3;
  }
  if (receipt.cancellation !== null) {
    return 130;
  }
  if (receipt.outcome === "not-run") {
    return 2;
  }
  if (receipt.completion === "unknown") {
    return 4;
  }
  return receipt.outcome === "passed" && receipt.evidence === "stable" ? 0 : 1;
};

export const runCheck = async (
  root: string,
  configFile: string,
  base: string | null
): Promise<CheckReceipt> => {
  const start = performance.now();
  const receipt: CheckReceipt = {
    admission: "not-started",
    cancellation: null,
    cause: "unclassified",
    check: null,
    completion: "unknown",
    configAfter: null,
    configBefore: null,
    diagnostic: "config-invalid",
    durationMs: null,
    evidence: "unknown",
    exitCode: null,
    finishedAt: null,
    kind: "forge-check",
    outcome: "not-run",
    receiptId: randomUUID(),
    recording: { path: null, state: "failed" },
    repository: null,
    runtime: {
      arch: process.arch,
      bun: Bun.version,
      platform: process.platform,
    },
    schemaVersion: 1,
    signal: null,
    sourceAfter: null,
    sourceBefore: null,
    startedAt: new Date().toISOString(),
  };
  let file: string;
  try {
    const directory = path.join(
      git(root, ["rev-parse", "--absolute-git-dir"]).trim(),
      "forge-check",
      receipt.receiptId
    );
    await mkdir(directory, { mode: 0o700, recursive: true });
    file = path.join(directory, "receipt.json");
    receipt.recording = { path: file, state: "persisted" };
  } catch {
    receipt.diagnostic = "receipt-write-failed";
    return receipt;
  }
  try {
    const { config, identity } = await readConfig(configFile);
    receipt.configBefore = identity;
    receipt.repository = config.repository;
    receipt.check = {
      commandDigest: digest(JSON.stringify(config.check.command)),
      id: config.check.id,
    };
    receipt.diagnostic = "source-unavailable";
    if (git(root, ["rev-parse", "--show-prefix"]).trim() !== "") {
      throw new Error("Invoke at repository root");
    }
    if (base !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(base)) {
      throw new Error("Base must be an explicit commit object ID");
    }
    receipt.sourceBefore = observeSource(root, base);
    receipt.diagnostic = "execution-incomplete";
    receipt.admission = "unknown";
    receipt.outcome = "unknown";
    // Persist before admission: a crash in the spawn window cannot imply that
    // project code never ran. A leftover record never establishes completion.
    try {
      await persist(file, receipt);
    } catch {
      receipt.recording = { path: null, state: "failed" };
      receipt.admission = "not-started";
      receipt.outcome = "not-run";
      receipt.diagnostic = "receipt-write-failed";
      return receipt;
    }
    await execute(root, config.check.command, receipt);
    try {
      receipt.configAfter = digest(await readFile(configFile));
      receipt.sourceAfter = observeSource(root, base);
      receipt.evidence =
        receipt.configBefore === receipt.configAfter &&
        JSON.stringify(receipt.sourceBefore) ===
          JSON.stringify(receipt.sourceAfter)
          ? "stable"
          : "changed";
    } catch {
      receipt.evidence = "unknown";
    }
  } catch {
    // Fixed codes cannot quote input, command output, credentials, or exceptions.
    if (receipt.admission === "not-started") {
      receipt.completion = "observed";
    }
  }
  receipt.finishedAt = new Date().toISOString();
  receipt.durationMs = Math.round(performance.now() - start);
  try {
    await persist(file, receipt);
  } catch {
    receipt.recording = { path: null, state: "failed" };
    receipt.diagnostic = "receipt-write-failed";
  }
  return receipt;
};
