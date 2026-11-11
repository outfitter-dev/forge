import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { observeSource } from "../src/check-source.ts";
import { configure, fixture, gitFixture, run } from "./check-fixtures.ts";

const roots: string[] = [];
const project = (code?: string) => {
  const root = fixture(code);
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("successful check records exact config/source/runtime and no environment or command output", () => {
  const root = project(
    'console.log("private-command-output"); console.error("private-stderr")'
  );
  const result = run(root);
  expect(result.code).toBe(0);
  expect(result.receipt).toMatchObject({
    admission: "started",
    cause: "unclassified",
    completion: "observed",
    evidence: "stable",
    exitCode: 0,
    kind: "forge-check",
    outcome: "passed",
    recording: { state: "persisted" },
    schemaVersion: 1,
    sourceBefore: { base: null, dirty: false, mergeBase: null, untracked: 0 },
  });
  expect(result.receipt.sourceBefore).toEqual(result.receipt.sourceAfter);
  expect(result.receipt.runtime.bun).toBe(Bun.version);
  expect(result.receipt.durationMs).toBeGreaterThanOrEqual(0);
  expect(result.stderr).toContain("private-command-output");
  expect(result.stderr).toContain("private-stderr");
  expect(result.stdout).not.toContain("private-");
  expect(result.stdout).not.toContain("environment-secret-marker");
  expect(
    JSON.parse(readFileSync(result.receipt.recording.path ?? "", "utf-8"))
  ).toEqual(result.receipt);
  expect(gitFixture(root, "status", "--porcelain")).toBe("");
});

test("ordinary failure never infers a flaky cause or retry permission", () => {
  const result = run(project("process.exit(7)"));
  expect(result.code).toBe(1);
  expect(result.receipt).toMatchObject({
    cause: "unclassified",
    diagnostic: "command-failed-unclassified",
    exitCode: 7,
    outcome: "failed",
  });
});

test("missing executable is terminal attempt observation without child admission", () => {
  const root = project();
  configure(root, ["/nonexistent-forge-fixture-command"]);
  const result = run(root);
  expect(result.code).toBe(2);
  expect(result.receipt).toMatchObject({
    admission: "not-started",
    completion: "observed",
    diagnostic: "command-start-failed",
    exitCode: null,
    outcome: "not-run",
  });
});

test.each([
  "{private-json-marker",
  '{"schemaVersion":2}',
  '{"schemaVersion":1,"repository":"x","check":{"id":"test","command":[]}}',
  '{"schemaVersion":1,"repository":"x","check":{"id":"test","command":["true"]},"extra":true}',
])(
  "invalid configuration records non-admission without quoting input: %s",
  (contents) => {
    const root = project();
    writeFileSync(path.join(root, "forge.json"), contents);
    const result = run(root);
    expect(result.code).toBe(2);
    expect(result.receipt).toMatchObject({
      admission: "not-started",
      diagnostic: "config-invalid",
      outcome: "not-run",
      recording: { state: "persisted" },
    });
    expect(result.stdout + result.stderr).not.toContain("private-json-marker");
  }
);

test.each(["input.txt", "forge.json", "new.txt"])(
  "successful mutation of %s changes applicability without changing exit fact",
  (file) => {
    const root = project(
      `require('fs').appendFileSync(${JSON.stringify(file)}, 'changed')`
    );
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.receipt).toMatchObject({
      evidence: "changed",
      exitCode: 0,
      outcome: "passed",
    });
    expect(result.receipt.sourceBefore?.worktreeDigest).not.toBe(
      result.receipt.sourceAfter?.worktreeDigest
    );
    if (file === "forge.json") {
      expect(result.receipt.configBefore).not.toBe(result.receipt.configAfter);
    }
  }
);

test("dirty, staged and nonignored untracked bytes all affect receipt identity; ignored bytes do not", () => {
  const root = project();
  const before = observeSource(root, null);
  writeFileSync(path.join(root, "input.txt"), "modified");
  const dirty = observeSource(root, null);
  expect(dirty.dirty).toBe(true);
  expect(dirty.worktreeDigest).not.toBe(before.worktreeDigest);
  gitFixture(root, "add", "input.txt");
  const staged = observeSource(root, null);
  expect(staged.worktreeDigest).toBe(dirty.worktreeDigest);
  expect(staged.indexDigest).not.toBe(dirty.indexDigest);
  writeFileSync(path.join(root, "new.txt"), "new");
  const untracked = observeSource(root, null);
  expect(untracked.untracked).toBe(1);
  expect(untracked.worktreeDigest).not.toBe(staged.worktreeDigest);
  writeFileSync(path.join(root, "ignored"), "private-ignore-marker");
  expect(observeSource(root, null)).toEqual(untracked);
  const result = run(root);
  expect(result.code).toBe(0);
  expect(result.receipt.sourceBefore?.dirty).toBe(true);
  expect(result.stdout).not.toContain("private-ignore-marker");
});

test("deletions, executable modes and symlink targets change source identity", () => {
  const root = project();
  const before = observeSource(root, null);
  chmodSync(path.join(root, "input.txt"), 0o755);
  expect(observeSource(root, null).worktreeDigest).not.toBe(
    before.worktreeDigest
  );
  rmSync(path.join(root, "input.txt"));
  const deleted = observeSource(root, null);
  expect(deleted.worktreeDigest).not.toBe(before.worktreeDigest);
  symlinkSync("ignored", path.join(root, "input.txt"));
  expect(observeSource(root, null).worktreeDigest).not.toBe(
    deleted.worktreeDigest
  );
});

test("explicit single PR and stack layer bases bind separately; absent base is never inferred", () => {
  const root = project();
  const base = gitFixture(root, "rev-parse", "HEAD");
  writeFileSync(path.join(root, "layer.txt"), "layer");
  gitFixture(root, "add", ".");
  gitFixture(root, "-c", "core.hooksPath=/dev/null", "commit", "-qm", "layer");
  const layer = gitFixture(root, "rev-parse", "HEAD");
  const single = run(root, ["--base", base]).receipt;
  const stacked = run(root, ["--base", layer]).receipt;
  expect(single.sourceBefore?.mergeBase).toBe(base);
  expect(stacked.sourceBefore?.mergeBase).toBe(layer);
  expect(single.sourceBefore?.head).toBe(stacked.sourceBefore?.head);
  expect(single.sourceBefore).not.toEqual(stacked.sourceBefore);
  expect(run(root).receipt.sourceBefore?.base).toBeNull();
  expect(run(root, ["--base", "main"]).code).toBe(2);
  expect(run(root, ["--base", "0".repeat(40)]).code).toBe(2);
});

test("config/command and receipt identities cannot be inherited by a later run", () => {
  const root = project();
  const before = run(root).receipt;
  configure(root, [
    process.execPath,
    "-e",
    "process.exit(0); // different command",
  ]);
  const after = run(root).receipt;
  expect(after.configBefore).not.toBe(before.configBefore);
  expect(after.check?.commandDigest).not.toBe(before.check?.commandDigest);
  expect(after.receiptId).not.toBe(before.receiptId);
});

test("receipt setup failure prevents command admission and never claims a published artifact", () => {
  const root = project('require("fs").writeFileSync("ran", "yes")');
  writeFileSync(path.join(root, ".git", "forge-check"), "obstruction");
  const result = run(root);
  expect(result.code).toBe(3);
  expect(result.receipt).toMatchObject({
    admission: "not-started",
    diagnostic: "receipt-write-failed",
    recording: { path: null, state: "failed" },
  });
  expect(observeSource(root, null).untracked).toBe(0);
});

test("final publication failure preserves execution facts but never claims durability", () => {
  const root = project(
    'const fs=require("fs"); fs.rmSync(".git/forge-check",{recursive:true}); fs.writeFileSync(".git/forge-check","obstruction")'
  );
  const result = run(root);
  expect(result.code).toBe(3);
  expect(result.receipt).toMatchObject({
    diagnostic: "receipt-write-failed",
    exitCode: 0,
    outcome: "passed",
    recording: { path: null, state: "failed" },
  });
});

test("unsupported source coverage fails before executing", () => {
  const root = project();
  mkdirSync(path.join(root, "module"));
  const head = gitFixture(root, "rev-parse", "HEAD");
  gitFixture(
    root,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${head},module`
  );
  const result = run(root);
  expect(result.code).toBe(2);
  expect(result.receipt).toMatchObject({
    admission: "not-started",
    diagnostic: "source-unavailable",
  });
});
