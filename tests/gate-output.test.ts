import { afterEach, expect, test } from "bun:test";

import { parseGateArguments } from "../src/gate-arguments.ts";
import { BASE, HEAD } from "./evidence-fixtures.ts";
import { codexPass, codexPolicy } from "./gate-codex-fixtures.ts";
import {
  cleanupGateWorkspace,
  gateArgs,
  run,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";

afterEach(cleanupGateWorkspace);

test("default and explicit v1 output preserve the evaluator result and exit code of v2", () => {
  const ws = workspace();
  seedLedger(ws);
  const args = gateArgs(ws, { policy: codexPolicy(), review: null });
  const source = { script: { passes: [codexPass()] } };
  const defaultResult = run(ws, args, { ...source, outputVersion: null });
  const legacy = run(ws, [...args, "--output-version", "1"], {
    ...source,
    outputVersion: 1,
  });
  const modern = run(ws, [...args, "--output-version", "2"], {
    ...source,
    outputVersion: 2,
  });
  expect(defaultResult.document.schemaVersion).toBe(1);
  expect(defaultResult.document).toEqual(legacy.document);
  expect(defaultResult.exitCode).toBe(modern.exitCode);
  expect(defaultResult.document.status).toBe("evaluated");
  if (
    defaultResult.document.status === "evaluated" &&
    modern.document.status === "evaluated"
  ) {
    expect(defaultResult.document.evaluation).toEqual(
      modern.document.evaluation
    );
  }
  expect(defaultResult.document).toHaveProperty("codexReview");
  expect(defaultResult.document).not.toHaveProperty("reviewAdapters");
  expect(modern.document).toHaveProperty("reviewAdapters");
  expect(modern.document).not.toHaveProperty("codexReview");
  for (const result of [defaultResult, legacy, modern]) {
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
  }
});

test.each(["evaluated", "not-collected", "invalid-input"])(
  "the production default preserves the v1 %s envelope",
  (status) => {
    const ws = workspace();
    seedLedger(ws);
    let args = gateArgs(ws, { policy: codexPolicy(), review: null });
    if (status === "not-collected") {
      args = [
        ...args,
        "--expected-head",
        "d".repeat(40),
        "--expected-base",
        BASE,
      ];
    }
    if (status === "invalid-input") {
      args = [];
    }
    const result = run(ws, args, {
      outputVersion: null,
      script: { passes: [codexPass()] },
    });
    expect(result.document).toMatchObject({
      kind: "forge-gate",
      schemaVersion: 1,
      status,
    });
    expect(result.document).not.toHaveProperty("reviewAdapters");
  }
);

test.each(["0", "3", "private-output-value"])(
  "invalid output selection stays readable and redacted",
  (version) => {
    const ws = workspace();
    const args = [...gateArgs(ws), "--output-version", version];
    const result = run(ws, args, { outputVersion: 1 });
    expect(result.document).toMatchObject({
      schemaVersion: 1,
      status: "invalid-input",
    });
    expect(result.exitCode).toBe(2);
    expect(result.requests).toEqual([]);
    expect(result.stdout).not.toContain("private-output-value");
  }
);

test("a duplicate output selection is refused in the established envelope", () => {
  const ws = workspace();
  const result = run(
    ws,
    [...gateArgs(ws), "--output-version", "1", "--output-version", "2"],
    { outputVersion: 1 }
  );
  expect(result.document).toMatchObject({
    schemaVersion: 1,
    status: "invalid-input",
  });
  expect(result.requests).toEqual([]);
});

test("output negotiation leaves expected-revision admission parsing intact", () => {
  const ws = workspace();
  for (const version of ["1", "2"]) {
    const parsed = parseGateArguments([
      ...gateArgs(ws),
      "--expected-head",
      HEAD,
      "--expected-base",
      BASE,
      "--output-version",
      version,
    ]);
    expect(parsed.valid).toBe(true);
    if (parsed.valid) {
      expect(parsed.arguments.expectedRevision).toEqual({
        baseSha: BASE,
        headSha: HEAD,
      });
    }
  }
});
