import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CheckReceipt, CheckSource } from "../src/check-types.ts";
import { BASE, HEAD, REPOSITORY } from "./evidence-fixtures.ts";

export const source = (overrides: Partial<CheckSource> = {}): CheckSource => ({
  base: BASE,
  coverage: "tracked-and-nonignored-untracked",
  dirty: false,
  head: HEAD,
  indexDigest: "8".repeat(64),
  mergeBase: BASE,
  tree: "c".repeat(40),
  untracked: 0,
  worktreeDigest: "9".repeat(64),
  ...overrides,
});

/** A persisted, stable, passing run of the aggregate check on the fixture PR. */
export const receipt = (
  overrides: Partial<CheckReceipt> = {}
): CheckReceipt => ({
  admission: "started",
  cancellation: null,
  cause: "unclassified",
  check: { commandDigest: "f".repeat(64), id: "check" },
  completion: "observed",
  configAfter: "e".repeat(64),
  configBefore: "e".repeat(64),
  diagnostic: "command-passed",
  durationMs: 1200,
  evidence: "stable",
  exitCode: 0,
  finishedAt: "2026-01-01T00:00:02.000Z",
  kind: "forge-check",
  outcome: "passed",
  receiptId: "receipt-1",
  recording: { path: "/fixture/receipt.json", state: "persisted" },
  repository: REPOSITORY,
  runtime: { arch: "arm64", bun: "1.4.4", platform: "darwin" },
  schemaVersion: 1,
  signal: null,
  sourceAfter: source(),
  sourceBefore: source(),
  startedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

export const cli = path.resolve(import.meta.dir, "../src/forge-cli.ts");
export const gitFixture = (root: string, ...args: string[]): string => {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: root,
    env: {
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: process.env.PATH,
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString().trim();
};

export const configure = (root: string, command: string[]) => {
  writeFileSync(
    path.join(root, "forge.json"),
    JSON.stringify({
      check: { command, id: "test" },
      repository: "example/project",
      schemaVersion: 1,
    })
  );
};

export const fixture = (code = "process.exit(0)"): string => {
  const root = mkdtempSync(path.join(tmpdir(), "forge-check-"));
  gitFixture(root, "init", "-q");
  writeFileSync(path.join(root, ".gitignore"), "ignored\n");
  writeFileSync(path.join(root, "input.txt"), "original\n");
  configure(root, [process.execPath, "-e", code]);
  gitFixture(root, "add", ".");
  gitFixture(
    root,
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "fixture"
  );
  return root;
};

export const run = (root: string, args: string[] = []) => {
  const child = Bun.spawnSync([process.execPath, cli, "check", ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      PRIVATE_TEST_VALUE: "environment-secret-marker",
    },
  });
  return {
    code: child.exitCode,
    receipt: JSON.parse(child.stdout.toString()) as CheckReceipt,
    stderr: child.stderr.toString(),
    stdout: child.stdout.toString(),
  };
};
