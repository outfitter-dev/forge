import { expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

test("the report command preserves a finding exit and surfaces an empty result", () => {
  const root = mkdtempSync(path.join(tmpdir(), "forge-ropes-report-"));
  const source = path.join(import.meta.dir, "..");
  const entry = path.join("src", "ropes-markdown-report.ts");
  try {
    mkdirSync(path.join(root, "src"));
    copyFileSync(path.join(source, entry), path.join(root, entry));
    symlinkSync(
      path.join(source, "node_modules"),
      path.join(root, "node_modules")
    );
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { "ropes:markdown": "bun fixture.ts" } })
    );
    const run = (program: string) => {
      writeFileSync(path.join(root, "fixture.ts"), program);
      return Bun.spawnSync([process.execPath, entry], {
        cwd: root,
        env: { PATH: process.env.PATH },
      });
    };

    const findings = {
      ...frame,
      outcome: "findings",
      steps: [
        {
          adapter: "rumdl",
          findings: [],
          path: "README.md",
          status: "findings",
        },
      ],
    };
    const finding = run(
      `console.log(JSON.stringify(${JSON.stringify(findings)})); process.exitCode = 1;`
    );
    expect(finding.exitCode).toBe(1);
    expect(finding.stdout.toString()).toContain(
      "Findings remain. Exit code 1."
    );

    const missing = run(
      'console.error("fixture setup failed"); process.exitCode = 2;'
    );
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr.toString()).toContain("fixture setup failed");
    expect(missing.stderr.toString()).toContain("without a check result");
    expect(missing.stdout.toString()).toBe("");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
