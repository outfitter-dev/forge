import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { evaluateEvidence } from "../src/index.ts";
import { passingFacts, policy } from "./evidence-fixtures.ts";

const root = path.resolve(import.meta.dir, "..");
const cli = path.join(root, "src/cli.ts");
const examples = path.join(root, "examples/evidence");
const policyFile = path.join(examples, "policy.json");
const temporary: string[] = [];

const run = (args: string[], cwd = root) => {
  const child = Bun.spawnSync([process.execPath, cli, ...args], {
    cwd,
    env: {},
  });
  return {
    exitCode: child.exitCode,
    stderr: child.stderr.toString(),
    stdout: child.stdout.toString(),
  };
};

const fixture = (name: string, contents: string) => {
  const directory = mkdtempSync(path.join(tmpdir(), "forge cli "));
  temporary.push(directory);
  const file = path.join(directory, name);
  writeFileSync(file, contents);
  return file;
};

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each([
  ["passing-pr.json", 0, "evaluated"],
  ["blocked-pr.json", 1, "evaluated"],
  ["invalid-facts.json", 2, "invalid"],
] as const)(
  "%s emits structured output and exits %i",
  (name, exitCode, status) => {
    const child = run([path.join(examples, name), "--policy", policyFile]);
    const result = JSON.parse(child.stdout) as {
      status: string;
      eligible: boolean;
    };
    expect(child.exitCode).toBe(exitCode);
    expect(result.status).toBe(status);
    expect(result.eligible).toBe(exitCode === 0);
    expect(child.stderr.length > 0).toBe(exitCode === 2);
  }
);

test.each([
  ["passing-pr.json", 0, "satisfied"],
  ["blocked-pr.json", 1, "blocked"],
  ["needs-human-pr.json", 1, "needs_human"],
] as const)(
  "version 2 %s exits %i with a %s review",
  (name, exitCode, disposition) => {
    const directory = path.join(examples, "v2");
    const child = run([
      path.join(directory, name),
      "--policy",
      path.join(directory, "policy.json"),
    ]);
    const result: unknown = JSON.parse(child.stdout);
    expect(child.exitCode).toBe(exitCode);
    expect(result).toMatchObject({
      agentReview: [{ disposition, pullRequest: 1 }],
      eligible: exitCode === 0,
      schemaVersion: 2,
      status: "evaluated",
    });
  }
);

test("evidence and policy of different schema versions are invalid", () => {
  const child = run([
    path.join(examples, "passing-pr.json"),
    "--policy",
    path.join(examples, "v2/policy.json"),
  ]);
  expect(child.exitCode).toBe(2);
  expect(JSON.parse(child.stdout)).toMatchObject({
    issues: [{ path: "facts.schemaVersion" }],
    status: "invalid",
  });
});

test("CLI output matches the same pure evaluator for passing and blocked facts", () => {
  for (const state of ["passed", "failed"] as const) {
    const facts = passingFacts();
    facts.pullRequest.checks = facts.pullRequest.checks.map((check) => ({
      ...check,
      state,
    }));
    const file = fixture("facts.json", JSON.stringify(facts));
    const child = run([file, "--policy", policyFile]);
    expect(JSON.parse(child.stdout)).toEqual(evaluateEvidence(facts, policy()));
  }
});

test("paths resolve against the caller cwd and support spaces", () => {
  const file = fixture(
    "facts with spaces.json",
    JSON.stringify(passingFacts())
  );
  const child = run(
    [path.basename(file), "--policy", policyFile],
    path.dirname(file)
  );
  expect(child.exitCode).toBe(0);
  expect(child.stderr).toBe("");
});

test.each(["facts", "policy"] as const)(
  "missing or unreadable %s file exits 2",
  (kind) => {
    const directory = path.dirname(fixture("placeholder.json", "{}"));
    for (const file of [path.join(directory, "missing.json"), directory]) {
      const child = run([
        kind === "facts" ? file : path.join(examples, "passing-pr.json"),
        "--policy",
        kind === "policy" ? file : policyFile,
      ]);
      expect(child.exitCode).toBe(2);
      expect(JSON.parse(child.stdout)).toMatchObject({
        eligible: false,
        issues: [{ path: kind }],
        status: "invalid",
      });
      expect(child.stderr).toContain(`Unable to read or parse ${kind} JSON`);
    }
  }
);

test.each(["facts", "policy"] as const)(
  "malformed %s JSON exits 2 without quoting input",
  (kind) => {
    const marker = "private-input-marker";
    const file = fixture("malformed.json", `{"${marker}":`);
    const child = run([
      kind === "facts" ? file : path.join(examples, "passing-pr.json"),
      "--policy",
      kind === "policy" ? file : policyFile,
    ]);
    expect(child.exitCode).toBe(2);
    expect(JSON.parse(child.stdout)).toMatchObject({
      eligible: false,
      status: "invalid",
    });
    expect(child.stdout + child.stderr).not.toContain(marker);
  }
);

test("invalid policy and missing facts cannot look successful", () => {
  for (const [facts, requirements] of [
    [passingFacts(), { ...policy(), requiredAgentProviders: [] }],
    [{}, policy()],
  ]) {
    const factsFile = fixture("facts.json", JSON.stringify(facts));
    const requirementsFile = fixture(
      "policy.json",
      JSON.stringify(requirements)
    );
    const child = run([factsFile, "--policy", requirementsFile]);
    expect(child.exitCode).toBe(2);
    expect(JSON.parse(child.stdout)).toMatchObject({
      eligible: false,
      status: "invalid",
    });
    expect(child.stderr.length).toBeGreaterThan(0);
  }
});

test.each([
  [],
  ["facts.json"],
  ["facts.json", "--policy"],
  ["facts.json", "--unknown", "policy.json"],
  ["facts.json", "--policy", "policy.json", "extra.json"],
])("invalid arguments %p emit usage and exit 2", (...args: string[]) => {
  const child = run(args);
  expect(child.exitCode).toBe(2);
  expect(JSON.parse(child.stdout)).toMatchObject({
    eligible: false,
    issues: [{ path: "arguments" }],
    status: "invalid",
  });
  expect(child.stderr).toContain("Usage:");
});

test("package evaluate command invokes the same CLI", () => {
  const child = Bun.spawnSync(
    [
      process.execPath,
      "run",
      "evaluate",
      "examples/evidence/passing-pr.json",
      "--policy",
      "examples/evidence/policy.json",
    ],
    { cwd: root, env: {} }
  );
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual(
    evaluateEvidence(passingFacts(), policy())
  );
});

test("unexpected evaluator failure exits 2 without leaking exception text", () => {
  const marker = "private-exception-marker";
  const evaluator = path.join(root, "src/evaluate-evidence.ts");
  const preload = fixture(
    "throwing-evaluator.ts",
    `import {mock} from "bun:test"; mock.module(${JSON.stringify(evaluator)}, () => ({evaluateEvidence: () => {throw new Error(${JSON.stringify(marker)});}}));`
  );
  const child = Bun.spawnSync(
    [
      process.execPath,
      "--preload",
      preload,
      cli,
      path.join(examples, "passing-pr.json"),
      "--policy",
      policyFile,
    ],
    { cwd: root, env: {} }
  );
  expect(child.exitCode).toBe(2);
  expect(JSON.parse(child.stdout.toString())).toMatchObject({
    eligible: false,
    issues: [{ message: "Evidence evaluation failed", path: "evaluation" }],
    status: "invalid",
  });
  expect(child.stderr.toString()).toContain("Evidence evaluation failed");
  expect(child.stdout.toString() + child.stderr.toString()).not.toContain(
    marker
  );
});
