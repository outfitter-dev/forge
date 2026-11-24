import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readBuildkiteProjectCapture } from "../src/buildkite-capture-store.ts";
import { captureBuildkiteProjectCheck } from "../src/buildkite-project-capture.ts";
import { digest } from "../src/check-config.ts";
import { configure, fixture, gitFixture } from "./check-fixtures.ts";

const roots: string[] = [];
const directory = () => {
  const value = mkdtempSync(path.join(tmpdir(), "forge-capture-"));
  roots.push(value);
  return value;
};
let runner = "";
beforeAll(() => {
  runner = path.join(directory(), "project-check");
  const build = Bun.spawnSync([
    process.execPath,
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    path.resolve(import.meta.dir, "../src/buildkite-project-check.ts"),
    "--outfile",
    runner,
  ]);
  expect(build.exitCode).toBe(0);
});
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});
const jobId = "00000000-0000-4000-8000-000000000001";
const input = (command = "exit 0") => {
  const projectRoot = fixture();
  roots.push(projectRoot);
  const base = gitFixture(projectRoot, "rev-parse", "HEAD");
  configure(projectRoot, ["/bin/sh", "-c", command]);
  gitFixture(projectRoot, "add", "forge.json");
  gitFixture(projectRoot, "commit", "-qm", "proposal");
  return {
    base,
    captureRoot: directory(),
    head: gitFixture(projectRoot, "rev-parse", "HEAD"),
    jobId,
    launcher: "/usr/bin/env",
    projectRoot,
    repository: "example/project",
    runner,
    timeoutMs: 10_000,
    toolBin: path.dirname(process.execPath),
  };
};

test.each([0, 17])(
  "captures actual command exit %i and preserves exact bytes",
  async (exit) => {
    const args = input(`test -z "$FORGE_GITHUB_TOKEN$HOME" && exit ${exit}`);
    const result = await captureBuildkiteProjectCheck(args);
    expect(result.status).toBe("captured");
    if (result.status !== "captured") {
      throw new Error(result.reason);
    }
    const bytes = readFileSync(result.receiptFile);
    expect(bytes.at(-1)).toBe(10);
    expect(result.capture.receiptSha256).toBe(digest(bytes));
    expect(result.capture.runnerExitCode).toBe(exit === 0 ? 0 : 1);
    expect(JSON.parse(bytes.toString())).toMatchObject({
      admission: "started",
      completion: "observed",
      exitCode: exit,
      outcome: exit === 0 ? "passed" : "failed",
      sourceBefore: { base: args.base, head: args.head },
    });
    expect(await readBuildkiteProjectCapture(args.captureRoot, jobId)).toEqual(
      result.capture
    );
    expect(await captureBuildkiteProjectCheck(args)).toEqual({
      reason: "store-unavailable",
      status: "not-captured",
    });
  }
);

test("protected capture refuses a store within the proposed checkout", async () => {
  const args = input();
  expect(
    await captureBuildkiteProjectCheck({
      ...args,
      captureRoot: args.projectRoot,
    })
  ).toEqual({ reason: "invalid-input", status: "not-captured" });
});

const launcher = (body: string) => {
  const file = path.join(directory(), "launch");
  writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  return file;
};

test.each([
  ["/usr/bin/head -c 65537 /dev/zero", "output-limit"],
  ["/bin/sleep 5", "deadline"],
] as const)(
  "withholds capture when launcher exceeds %s",
  async (body, reason) => {
    const args = input();
    expect(
      await captureBuildkiteProjectCheck({
        ...args,
        launcher: launcher(body),
        timeoutMs: reason === "deadline" ? 200 : 10_000,
      })
    ).toEqual({ reason, status: "not-captured" });
    expect(
      await readBuildkiteProjectCapture(args.captureRoot, jobId)
    ).toBeNull();
  }
);

test("store reader refuses symlinks and public capture directories", async () => {
  const args = input();
  const result = await captureBuildkiteProjectCheck(args);
  expect(result.status).toBe("captured");
  const record = path.join(args.captureRoot, jobId, "capture.json");
  const copy = path.join(directory(), "record");
  writeFileSync(copy, readFileSync(record), { mode: 0o600 });
  rmSync(record);
  symlinkSync(copy, record);
  expect(await readBuildkiteProjectCapture(args.captureRoot, jobId)).toBeNull();
  rmSync(record);
  writeFileSync(record, readFileSync(copy), { mode: 0o600 });
  chmodSync(path.dirname(record), 0o755);
  expect(await readBuildkiteProjectCapture(args.captureRoot, jobId)).toBeNull();
});

test("operator CLI captures the fixed runner invocation and returns its record", () => {
  const args = input();
  const config = path.join(directory(), "launch.json");
  writeFileSync(config, JSON.stringify(args), { mode: 0o600 });
  const child = Bun.spawnSync(
    [
      process.execPath,
      path.resolve(import.meta.dir, "../src/buildkite-project-capture-cli.ts"),
      config,
    ],
    { cwd: path.resolve(import.meta.dir, ".."), env: {} }
  );
  expect(child.exitCode).toBe(0);
  const result = JSON.parse(child.stdout.toString());
  expect(result).toMatchObject({
    capture: { jobId, runnerExitCode: 0 },
    status: "captured",
  });
  expect(digest(readFileSync(result.receiptFile))).toBe(
    result.capture.receiptSha256
  );
});

test("launcher failure and a signal cannot publish a qualifying record", async () => {
  const args = input();
  expect(
    await captureBuildkiteProjectCheck({
      ...args,
      launcher: launcher("kill -TERM $$"),
    })
  ).toEqual({ reason: "runner-signaled", status: "not-captured" });
  expect(await readBuildkiteProjectCapture(args.captureRoot, jobId)).toBeNull();
});

test("capture reader refuses an oversized or foreign job record", async () => {
  const args = input();
  await captureBuildkiteProjectCheck(args);
  const record = path.join(args.captureRoot, jobId, "capture.json");
  writeFileSync(record, " ".repeat(4097));
  expect(await readBuildkiteProjectCapture(args.captureRoot, jobId)).toBeNull();
  writeFileSync(
    record,
    JSON.stringify({
      jobId: "00000000-0000-4000-8000-000000000002",
      receiptSha256: "a".repeat(64),
      runnerExitCode: 0,
    })
  );
  expect(await readBuildkiteProjectCapture(args.captureRoot, jobId)).toBeNull();
});

const waitForPid = async (file: string) => {
  const deadline = Date.now() + 4000;
  while (!existsSync(file) || readFileSync(file, "utf-8").trim() === "") {
    if (Date.now() > deadline) {
      throw new Error("Project command did not start");
    }
    // oxlint-disable-next-line eslint/no-await-in-loop
    await Bun.sleep(10);
  }
  return Number(readFileSync(file, "utf-8"));
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const ignoringCommand =
  "printf '%s' $$ > .git/capture-child; trap '' TERM; while :; do /bin/sleep 1; done";

test("deadline reaches the real check's separate process group", async () => {
  const args = input(ignoringCommand);
  const running = captureBuildkiteProjectCheck({ ...args, timeoutMs: 1200 });
  const pid = await waitForPid(
    path.join(args.projectRoot, ".git/capture-child")
  );
  try {
    expect(await running).toEqual({
      reason: "deadline",
      status: "not-captured",
    });
    expect(alive(pid)).toBe(false);
    expect(existsSync(path.join(args.captureRoot, jobId))).toBe(false);
  } finally {
    if (alive(pid)) {
      process.kill(-pid, "SIGKILL");
    }
  }
}, 10_000);

test.each(["SIGINT", "SIGTERM"] as const)(
  "CLI %s cancels the real check and removes its reservation",
  async (signal) => {
    const args = input(ignoringCommand);
    const config = path.join(directory(), "launch.json");
    writeFileSync(config, JSON.stringify(args), { mode: 0o600 });
    const child = Bun.spawn(
      [
        process.execPath,
        path.resolve(
          import.meta.dir,
          "../src/buildkite-project-capture-cli.ts"
        ),
        config,
      ],
      {
        cwd: path.resolve(import.meta.dir, ".."),
        env: {},
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    let pid = 0;
    try {
      pid = await waitForPid(path.join(args.projectRoot, ".git/capture-child"));
      child.kill(signal);
      expect(await child.exited).toBe(1);
      expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
        reason: "canceled",
        status: "not-captured",
      });
      expect(alive(pid)).toBe(false);
      expect(existsSync(path.join(args.captureRoot, jobId))).toBe(false);
    } finally {
      child.kill();
      if (pid > 0 && alive(pid)) {
        process.kill(-pid, "SIGKILL");
      }
    }
  },
  10_000
);

test.each(["staging", "committed"] as const)(
  "cancellation at %s respects the capture publication commit point",
  (phase) => {
    const args = input();
    const source = `
    const fs = require("node:fs");
    const promises = require("node:fs/promises");
    const controller = new AbortController();
    const write = promises.writeFile;
    promises.writeFile = async (...values) => {
      await write(...values);
      if (String(values[0]).endsWith("capture.pending") && ${JSON.stringify(phase)} === "staging") controller.abort();
    };
    const rename = fs.renameSync;
    fs.renameSync = (...values) => {
      rename(...values);
      if (${JSON.stringify(phase)} === "committed") controller.abort();
    };
    const { captureBuildkiteProjectCheck } = await import(${JSON.stringify(path.resolve(import.meta.dir, "../src/buildkite-project-capture.ts"))});
    const result = await captureBuildkiteProjectCheck(${JSON.stringify(args)}, controller.signal);
    console.log(JSON.stringify({ result, aborted: controller.signal.aborted, record: fs.existsSync(${JSON.stringify(path.join(args.captureRoot, jobId, "capture.json"))}), directory: fs.existsSync(${JSON.stringify(path.join(args.captureRoot, jobId))}) }));
  `;
    const child = Bun.spawnSync([process.execPath, "-e", source], {
      cwd: path.resolve(import.meta.dir, ".."),
      env: {},
    });
    expect(child.exitCode).toBe(0);
    const observed = JSON.parse(child.stdout.toString());
    expect(observed.aborted).toBe(true);
    if (phase === "staging") {
      expect(observed).toMatchObject({
        directory: false,
        record: false,
        result: { reason: "canceled", status: "not-captured" },
      });
    } else {
      expect(observed).toMatchObject({
        directory: true,
        record: true,
        result: { capture: { runnerExitCode: 0 }, status: "captured" },
      });
    }
  }
);
