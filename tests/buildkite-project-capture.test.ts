import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
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
