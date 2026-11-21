import { expect, test } from "bun:test";

import { markdownReport } from "../src/ropes-markdown-report.ts";

const plan = {
  batches: [],
  paths: [],
  root: "/fixture",
  schemaVersion: 3,
  selection: { kind: "workspace" },
};

const frame = {
  outcome: "clean",
  plan,
  schemaVersion: 3,
  steps: [],
};

test("renders a validated Ropes result with its outcome and exit", () => {
  expect(markdownReport(JSON.stringify(frame), 0)).toContain(
    "Clean. Exit code 0."
  );
});

test("keeps a valid nonpassing outcome visible after validation", () => {
  const incomplete = {
    ...frame,
    outcome: "incomplete",
    steps: [
      {
        adapter: "rumdl",
        findings: [],
        path: "README.md",
        reason: "rumdl is not on PATH",
        status: "incomplete",
      },
    ],
  };
  expect(markdownReport(JSON.stringify(incomplete), 2)).toContain(
    "incomplete  rumdl: rumdl is not on PATH"
  );
});

test("rejects unknown versions, malformed input, and exit mismatches", () => {
  expect(() =>
    markdownReport(JSON.stringify({ ...frame, schemaVersion: 999 }), 0)
  ).toThrow("unsupported result schema version");
  expect(() => markdownReport("native output", 0)).toThrow("malformed JSON");
  expect(() => markdownReport(JSON.stringify({ schemaVersion: 3 }), 0)).toThrow(
    "invalid check result"
  );
  expect(() => markdownReport(JSON.stringify(frame), 1)).toThrow(
    "exit code disagrees"
  );
});
