import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { qualifyBuildkiteGateReceipt } from "../src/buildkite-gate-receipt.ts";
import { digest } from "../src/check-config.ts";
import { parseGatePolicy } from "../src/gate-policy.ts";
import { VERIFICATION_GATES } from "../src/index.ts";
import { fixture, gitFixture } from "./check-fixtures.ts";
import { codexPass, comment, comments } from "./gate-codex-fixtures.ts";
import { PULL_REQUEST, pullRequest, SERVED } from "./gate-fixtures.ts";
import {
  change,
  cleanupGateWorkspace,
  evaluated,
  gate,
  gateArgs,
  ledgerText,
  notCollected,
  root,
  run,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";

const repository = "outfitter-dev/forge";
const policyFile = path.join(root, "forge-gate.json");
const policy = parseGatePolicy(JSON.parse(readFileSync(policyFile, "utf-8")));
const temporary: string[] = [];
let executable = "";

beforeAll(() => {
  const buildRoot = mkdtempSync(path.join(tmpdir(), "forge-receipt-proof-"));
  temporary.push(buildRoot);
  executable = path.join(buildRoot, "project-check");
  const build = Bun.spawnSync([
    process.execPath,
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    path.join(root, "src/buildkite-project-check.ts"),
    "--outfile",
    executable,
  ]);
  expect(build.exitCode).toBe(0);
});
afterEach(cleanupGateWorkspace);
afterAll(() => {
  for (const directory of temporary) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const uuid = (digit: number) => `00000000-0000-4000-8000-00000000000${digit}`;

/** Executes a real disposable project. Buildkite identity and custody are fixtures. */
const projectRun = (script = "exit 0") => {
  const project = fixture();
  temporary.push(project);
  const base = gitFixture(project, "rev-parse", "HEAD");
  const command = ["/bin/sh", "-c", script];
  const config = JSON.stringify({
    check: { command, id: "check" },
    repository,
    schemaVersion: 1,
  });
  writeFileSync(path.join(project, "forge.json"), config);
  gitFixture(project, "add", "forge.json");
  gitFixture(project, "commit", "-qm", "proposal");
  const head = gitFixture(project, "rev-parse", "HEAD");
  const child = Bun.spawnSync(
    [executable, repository, head, base, path.dirname(process.execPath)],
    { cwd: project, env: {} }
  );
  // Capture stdout directly, including its newline, outside the proposal tree.
  const bytes = new Uint8Array(child.stdout);
  const admission = {
    base,
    buildId: uuid(1),
    head,
    jobId: uuid(2),
    organizationId: uuid(3),
    pipelineId: uuid(4),
    pullRequest: PULL_REQUEST,
    queueId: uuid(5),
    repository,
  };
  const { base: _base, ...identity } = admission;
  return {
    admission,
    bytes,
    capture: {
      jobId: admission.jobId,
      receiptSha256: digest(bytes),
      runnerExitCode: child.exitCode,
    },
    expectation: {
      checks: policy.checks,
      commandDigest: digest(JSON.stringify(command)),
      configDigest: digest(config),
      provenance: policy.evidence.verification,
      runtime: {
        arch: process.arch,
        bun: Bun.version,
        platform: process.platform,
      },
    },
    job: {
      ...identity,
      exitStatus: child.exitCode,
      softFailed: false,
      state: child.exitCode === 0 ? "passed" : "failed",
      stepKey: "forge-check",
      superseded: false,
      type: "script",
    },
  };
};

type ProjectRun = ReturnType<typeof projectRun>;

/** Only qualified bytes enter the real gate CLI, with a separate ledger. */
const gateRun = (
  input: ProjectRun,
  qualification: ReturnType<typeof qualifyBuildkiteGateReceipt>,
  expectedHead = input.admission.head,
  expectedBase = input.admission.base
) => {
  const ws = workspace();
  ws.ledgerFile = path.join(
    ws.ledgerDirectory,
    `outfitter-dev+forge+${PULL_REQUEST}.json`
  );
  seedLedger(ws);
  const initial = JSON.parse(ledgerText(ws));
  initial.observedRevision = {
    ...initial.observedRevision,
    baseSha: input.admission.base,
    headSha: input.admission.head,
  };
  writeFileSync(ws.ledgerFile, JSON.stringify(initial));
  const before = ledgerText(ws);
  let args = gateArgs(ws, {
    receipts: [],
    review: {
      agentReviews: [],
      reviewFindings: { findings: [], recorded: true },
      reviewLadder: null,
    },
  });
  args = change(
    change(args, "--repository", repository),
    "--policy",
    policyFile
  );
  if (qualification.receipt) {
    const file = path.join(ws.inputs, "qualified-receipt.json");
    writeFileSync(file, qualification.receipt);
    args.push("--receipt", file);
    expect(new Uint8Array(readFileSync(file))).toEqual(input.bytes);
  }
  args.push("--expected-head", expectedHead, "--expected-base", expectedBase);
  const served = pullRequest({
    base: {
      ref: "main",
      repo: { full_name: repository, id: 100, name: "forge" },
      sha: input.admission.base,
    },
    head: {
      ref: "proposal",
      repo: { id: 100, name: "forge" },
      sha: input.admission.head,
    },
  });
  const collected = codexPass({
    comments: { body: comments(comment({ commit_sha: input.admission.head })) },
    pullRequest: { body: served, date: SERVED },
  });
  return {
    before,
    ran: run(ws, args, { script: { passes: [collected] } }),
    ws,
  };
};

test("captured project runner bytes qualify through the committed policy and gate CLI", () => {
  const input = projectRun();
  const qualified = qualifyBuildkiteGateReceipt(input);
  expect(qualified.verification).toMatchObject({ verified: true });
  expect(qualified.receipt).toEqual(input.bytes);
  expect(qualified.receipt).not.toBe(input.bytes);
  expect(new TextDecoder().decode(input.bytes).endsWith("\n")).toBe(true);
  const { ran } = gateRun(input, qualified);
  expect(ran.exitCode).toBe(0);
  expect(evaluated(ran).eligible).toBe(true);
  expect(evaluated(ran).subject).toEqual({
    baseSha: input.admission.base,
    headSha: input.admission.head,
    pullRequest: PULL_REQUEST,
    repository,
  });
});

test.each([
  "failed",
  "missing",
  "execution-mismatch",
  "expectation-missing",
  "digest-mismatch",
  "oversized",
])(
  "%s project evidence stays withheld and blocks every mapped verification gate",
  (scenario) => {
    const input = projectRun(scenario === "failed" ? "exit 17" : "exit 0");
    if (scenario === "failed") {
      expect(input.capture.runnerExitCode).toBe(1);
      expect(input.job).toMatchObject({ exitStatus: 1, state: "failed" });
      const observed: unknown = JSON.parse(
        new TextDecoder().decode(input.bytes)
      );
      expect(observed).toMatchObject({
        admission: "started",
        check: { commandDigest: input.expectation.commandDigest, id: "check" },
        completion: "observed",
        configAfter: input.expectation.configDigest,
        configBefore: input.expectation.configDigest,
        evidence: "stable",
        exitCode: 17,
        outcome: "failed",
        recording: { state: "persisted" },
        repository,
        sourceAfter: {
          base: input.admission.base,
          dirty: false,
          head: input.admission.head,
        },
        sourceBefore: {
          base: input.admission.base,
          dirty: false,
          head: input.admission.head,
        },
      });
    }
    const supplied = {
      ...input,
      ...(scenario === "missing" ? { bytes: null } : {}),
      ...(scenario === "oversized"
        ? { bytes: new Uint8Array(64 * 1024 + 1) }
        : {}),
      ...(scenario === "execution-mismatch"
        ? {
            expectation: {
              ...input.expectation,
              commandDigest: "f".repeat(64),
            },
          }
        : {}),
      ...(scenario === "expectation-missing" ? { expectation: null } : {}),
      ...(scenario === "digest-mismatch"
        ? { capture: { ...input.capture, receiptSha256: "f".repeat(64) } }
        : {}),
    };
    const qualified = qualifyBuildkiteGateReceipt(supplied);
    expect(qualified.receipt).toBeNull();
    const reasons: Record<string, string> = {
      "digest-mismatch": "receipt-digest-mismatch",
      "execution-mismatch": "receipt-execution-mismatch",
      "expectation-missing": "expectation-unavailable",
      failed: "job-nonpassing",
      missing: "receipt-unavailable",
      oversized: "receipt-unavailable",
    };
    expect(qualified.verification).toMatchObject({ reason: reasons[scenario] });
    if (
      scenario === "execution-mismatch" ||
      scenario === "expectation-missing"
    ) {
      expect(qualified.verification).toMatchObject({
        checks: [],
        verified: true,
      });
    }
    const { ran } = gateRun(input, qualified);
    expect(ran.exitCode).toBe(1);
    for (const name of VERIFICATION_GATES) {
      expect(gate(ran, name).codes).toEqual(["missing-evidence"]);
    }
  }
);

test("a changed admitted head stops before the isolated ledger is updated", () => {
  const input = projectRun();
  const { before, ran, ws } = gateRun(
    input,
    qualifyBuildkiteGateReceipt(input),
    "f".repeat(40)
  );
  expect(ran.exitCode).toBe(3);
  expect(notCollected(ran)).toMatchObject({
    code: "head-mismatch",
    stage: "subject",
  });
  expect(ledgerText(ws)).toBe(before);
});

test("a changed admitted base stops before the isolated ledger is updated", () => {
  const input = projectRun();
  const { before, ran, ws } = gateRun(
    input,
    qualifyBuildkiteGateReceipt(input),
    input.admission.head,
    "f".repeat(40)
  );
  expect(ran.exitCode).toBe(3);
  expect(notCollected(ran)).toMatchObject({
    code: "base-mismatch",
    stage: "subject",
  });
  expect(ledgerText(ws)).toBe(before);
});
