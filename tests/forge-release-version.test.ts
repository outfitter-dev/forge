import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import blocked from "../examples/release-version/blocked.json";
import passing from "../examples/release-version/passing.json";
import policy from "../examples/release-version/policy.json";
import { evaluateReleaseVersion } from "../src/index.ts";

const root = path.resolve(import.meta.dir, "..");
const cli = path.join(root, "src/forge-cli.ts");
const examples = "examples/release-version";
const versionsPath = `${examples}/passing.json`;
const policyPath = `${examples}/policy.json`;
const temporary: string[] = [];

const run = (args: string[], cwd = root) => {
  const child = Bun.spawnSync([process.execPath, cli, "release", ...args], {
    cwd,
    env: {},
  });
  expect(child.stderr.toString()).toBe("");
  return {
    document: JSON.parse(child.stdout.toString()) as unknown,
    exitCode: child.exitCode,
  };
};

const fixture = (contents: string) => {
  const directory = mkdtempSync(path.join(tmpdir(), "forge release version "));
  temporary.push(directory);
  const file = path.join(directory, "input with spaces.json");
  writeFileSync(file, contents);
  return file;
};

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each([
  ["passing", passing, 0, []],
  ["blocked", blocked, 1, ["channel-tag-mismatch"]],
] as const)(
  "release version preserves the %s evaluator result",
  (name, input, exitCode, diagnostics) => {
    const result = run([
      "version",
      `${examples}/${name}.json`,
      "--policy",
      policyPath,
    ]);
    expect(result.exitCode).toBe(exitCode);
    expect(result.document).toMatchObject({ diagnostics });
    expect(result.document).toEqual(evaluateReleaseVersion(input, policy));
  }
);

test("same precedence blocks, and files resolve relative to the caller", () => {
  const input = { ...passing, previousVersion: passing.version };
  const file = fixture(JSON.stringify(input));
  const result = run(
    ["version", path.basename(file), "--policy", path.join(root, policyPath)],
    path.dirname(file)
  );
  expect(result.exitCode).toBe(1);
  expect(result.document).toMatchObject({ diagnostics: ["version-not-newer"] });
  expect(result.document).toEqual(evaluateReleaseVersion(input, policy));
});

test("valid JSON with an invalid policy shape preserves the evaluator block", () => {
  const result = run(["version", versionsPath, "--policy", fixture("null")]);
  expect(result).toEqual({
    document: {
      binding: null,
      change: null,
      decision: "block",
      diagnostics: ["invalid-input"],
    },
    exitCode: 1,
  });
});

const expectInputError = (
  result: ReturnType<typeof run>,
  diagnostic: string
) => {
  expect(result).toEqual({
    document: {
      diagnostic,
      kind: "forge-release-version-input-error",
      schemaVersion: 1,
    },
    exitCode: 2,
  });
};

test.each([
  [[]],
  [["other"]],
  [["version", versionsPath]],
  [["version", versionsPath, "--policy"]],
  [["version", versionsPath, "--policy", "--other"]],
  [["version", versionsPath, "--other", policyPath]],
  [["version", versionsPath, "--policy", policyPath, "--policy", policyPath]],
])("malformed release invocation exits 2: %j", (args) => {
  expectInputError(
    run(args),
    "Usage: forge release version <versions.json> --policy <policy.json>"
  );
});

test.each(["versions", "policy"] as const)(
  "unreadable or malformed %s JSON exits 2 without echoing data",
  (stage) => {
    const malformed = fixture('{"untrusted-json-marker":');
    for (const file of [malformed, `${malformed}.missing`]) {
      const result = run([
        "version",
        stage === "versions" ? file : versionsPath,
        "--policy",
        stage === "policy" ? file : policyPath,
      ]);
      expectInputError(result, `Unable to read or parse ${stage} JSON`);
    }
  }
);
