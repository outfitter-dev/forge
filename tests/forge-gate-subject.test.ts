import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { BASE, HEAD } from "./evidence-fixtures.ts";
import {
  cleanupGateWorkspace,
  evaluated,
  gateArgs,
  issues,
  ledgerText,
  notCollected,
  run,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";

afterEach(cleanupGateWorkspace);

const expected = (head = HEAD, base = BASE) => [
  "--expected-head",
  head,
  "--expected-base",
  base,
];

test("a matching admitted head and base reaches evaluation and stores its collection", () => {
  const ws = workspace();
  const ran = run(ws, [...gateArgs(ws), ...expected()]);
  expect(ran.exitCode).toBe(0);
  expect(evaluated(ran).subject).toMatchObject({
    baseSha: BASE,
    headSha: HEAD,
  });
  expect(JSON.parse(ledgerText(ws)).observedRevision).toMatchObject({
    baseSha: BASE,
    headSha: HEAD,
  });
});

test.each<[string, string, string, "head-mismatch" | "base-mismatch"]>([
  ["head", "c".repeat(40), BASE, "head-mismatch"],
  ["base", HEAD, "c".repeat(40), "base-mismatch"],
])(
  "a different admitted %s stops before replacing a stored ledger",
  (_name, head, base, code) => {
    const ws = workspace();
    const before = seedLedger(ws);
    const ran = run(ws, [...gateArgs(ws), ...expected(head, base)]);
    expect(notCollected(ran)).toEqual({
      code,
      kind: "forge-gate",
      schemaVersion: 2,
      stage: "subject",
      status: "not-collected",
    });
    expect(ran.exitCode).toBe(3);
    expect(ran.requests.length).toBeGreaterThan(0);
    expect(ledgerText(ws)).toBe(before);
  }
);

test("a mismatched subject creates no ledger when none existed", () => {
  const ws = workspace();
  const ran = run(ws, [...gateArgs(ws), ...expected("c".repeat(40))]);
  expect(notCollected(ran).stage).toBe("subject");
  expect(existsSync(ws.state)).toBe(false);
});

test.each([
  [["--expected-head", HEAD], "--expected-base"],
  [["--expected-base", BASE], "--expected-head"],
  [expected("a".repeat(39)), "--expected-head"],
  [expected(HEAD, "b".repeat(64)), "--expected-base"],
  [expected("A".repeat(40)), "--expected-head"],
  [expected(HEAD, "private-input-marker"), "--expected-base"],
  [expected(""), "--expected-head"],
  [[...expected(), "--expected-head", HEAD], "--expected-head"],
  [[...expected(), "--expected-base"], "--expected-base"],
])("invalid expected revisions %j fail before reads", (args, flag) => {
  const ws = workspace();
  const ran = run(ws, [...gateArgs(ws), ...args]);
  expect(ran.exitCode).toBe(2);
  expect(issues(ran).map((issue) => issue.path)).toContain(flag);
  expect(ran.requests).toEqual([]);
  expect(existsSync(ws.state)).toBe(false);
  expect(ran.stdout).not.toContain("private-input-marker");
});
