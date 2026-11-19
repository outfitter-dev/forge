import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readRegularConfig } from "../src/check-config.ts";
import type { CheckReceipt } from "../src/check-types.ts";
import { configure, fixture, gitFixture } from "./check-fixtures.ts";

const roots: string[] = [];
const directory = () => {
  const root = mkdtempSync(path.join(tmpdir(), "forge-project-check-"));
  roots.push(root);
  return root;
};

let executable = "";
beforeAll(() => {
  executable = path.join(directory(), "forge-buildkite-project-check");
  const build = Bun.spawnSync([
    process.execPath,
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    path.resolve(import.meta.dir, "../src/buildkite-project-check.ts"),
    "--outfile",
    executable,
  ]);
  if (build.exitCode !== 0) {
    throw new Error(build.stderr.toString());
  }
});

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const repository = "example/project";
const project = (script = "touch .git/ran") => {
  const root = fixture();
  roots.push(root);
  const base = gitFixture(root, "rev-parse", "HEAD");
  configure(root, ["/bin/sh", "-c", script]);
  gitFixture(root, "add", "forge.json");
  gitFixture(root, "commit", "-qm", "proposal");
  const head = gitFixture(root, "rev-parse", "HEAD");
  const toolBin = path.dirname(process.execPath);
  return { args: [repository, head, base, toolBin], base, head, root, toolBin };
};

const run = (cwd: string, args: string[], env: Record<string, string> = {}) => {
  const child = Bun.spawnSync([executable, ...args], {
    cwd,
    env,
  });
  const stdout = child.stdout.toString();
  return {
    code: child.exitCode,
    receipt: stdout ? (JSON.parse(stdout) as CheckReceipt) : null,
    stderr: child.stderr.toString(),
  };
};

const expectNotRun = (root: string, args: string[]) => {
  const result = run(root, args);
  expect(result.code).toBe(2);
  expect(result.receipt).toMatchObject({
    admission: "not-started",
    outcome: "not-run",
  });
  expect(existsSync(path.join(root, ".git/ran"))).toBe(false);
};

test("runs the declared check with only the protected tool path and records both admitted revisions", () => {
  const { args, base, head, root, toolBin } = project(
    'test -z "$BUILDKITE_AGENT_ACCESS_TOKEN$BUILDKITE_COMMAND$FORGE_GITHUB_TOKEN$HOME$GIT_DIR" && printf "%s" "$PATH" > .git/ran'
  );
  const result = run(root, args);
  expect(result.code).toBe(0);
  expect(result.receipt).toMatchObject({
    admission: "started",
    evidence: "stable",
    outcome: "passed",
    recording: { state: "persisted" },
    repository,
    sourceAfter: { base, head, mergeBase: base },
    sourceBefore: { base, head, mergeBase: base },
  });
  expect(existsSync(path.join(root, ".git/buildkite-command-ran"))).toBe(false);
  expect(readFileSync(path.join(root, ".git/ran"), "utf-8")).toBe(
    `${toolBin}:/usr/bin:/bin`
  );
});

test("refuses an inherited environment before any proposal process can inspect it", () => {
  const { args, root } = project();
  const result = run(root, args, {
    BUILDKITE_AGENT_ACCESS_TOKEN: "fixture-only",
    BUILDKITE_COMMAND: "touch .git/buildkite-command-ran",
    HOME: "/mount-not-for-projects",
    PATH: "/untrusted/path",
  });
  expect(result).toMatchObject({ code: 2, receipt: null });
  expect(result.stderr).toContain("must start with an empty environment");
  expect(result.stderr).not.toContain("fixture-only");
  expect(existsSync(path.join(root, ".git/ran"))).toBe(false);
  expect(existsSync(path.join(root, ".git/buildkite-command-ran"))).toBe(false);
});

test("keeps a failed declared command non-passing with its exit code and receipt", () => {
  const { args, root } = project("exit 17");
  const result = run(root, args);
  expect(result.code).toBe(1);
  expect(result.receipt).toMatchObject({
    admission: "started",
    completion: "observed",
    exitCode: 17,
    outcome: "failed",
  });
});

test("does not pass a check whose command changes the admitted source", () => {
  const { args, root } = project("echo changed >> input.txt");
  const result = run(root, args);
  expect(result.code).toBe(1);
  expect(result.receipt).toMatchObject({
    admission: "started",
    evidence: "changed",
    outcome: "passed",
    sourceAfter: { dirty: true },
  });
});

test("records unavailable config evidence when the check leaves a directory in its place", () => {
  const { args, root } = project("rm forge.json && mkdir forge.json");
  const result = run(root, args);
  expect(result.code).toBe(1);
  expect(result.receipt).toMatchObject({
    admission: "started",
    configAfter: null,
    evidence: "unknown",
    outcome: "passed",
  });
});

test("the regular config reader does not follow a local config link", async () => {
  const root = directory();
  const file = path.join(root, "config.json");
  const link = path.join(root, "link.json");
  writeFileSync(file, "{}");
  symlinkSync("config.json", link);
  const bytes = await readRegularConfig(file);
  expect(bytes.toString()).toBe("{}");
  await expect(readRegularConfig(link)).rejects.toThrow();
});

test.each([
  ["wrong head", 1, "a".repeat(40)],
  ["missing base object", 2, "b".repeat(40)],
  ["wrong repository", 0, "elsewhere/project"],
] as const)("refuses a %s before execution", (_name, index, value) => {
  const { args, root } = project();
  args[index] = value;
  expectNotRun(root, args);
});

test.each(["input.txt", "untracked", "ignored"])(
  "refuses an existing workspace change in %s",
  (file) => {
    const { args, root } = project();
    writeFileSync(path.join(root, file), "residue");
    expectNotRun(root, args);
  }
);

test("refuses a shallow checkout even when its history includes the exact pins", () => {
  const { args, root } = project();
  const checkout = directory();
  gitFixture(checkout, "clone", "--depth", "2", `file://${root}`, ".");
  expectNotRun(checkout, args);
});

test("refuses a committed configuration symlink before reading its target", () => {
  const { args, root } = project();
  const file = path.join(root, "forge.json");
  const replacement = "config.json";
  writeFileSync(path.join(root, replacement), readFileSync(file));
  rmSync(file);
  symlinkSync(replacement, file);
  gitFixture(root, "add", "forge.json", replacement);
  gitFixture(root, "commit", "-qm", "link configuration");
  args[1] = gitFixture(root, "rev-parse", "HEAD");
  expectNotRun(root, args);
});

test("refuses a symbolic head and a directory without a standalone checkout", () => {
  const { args, root } = project();
  expect(run(directory(), args)).toMatchObject({ code: 2, receipt: null });
  args[1] = "HEAD";
  expect(run(root, args)).toMatchObject({ code: 2, receipt: null });
  expect(existsSync(path.join(root, ".git/ran"))).toBe(false);
});
