import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { qualifyBuildkiteGateReceipt } from "../src/buildkite-gate-receipt.ts";
import { VERIFICATION_GATES } from "../src/index.ts";
import {
  collectCapturedGateReceipt,
  collectCapturedProject,
  policyFile,
  projectRun,
  repository,
} from "./buildkite-capture-collection-fixture.ts";
import type { ProjectRun } from "./buildkite-capture-collection-fixture.ts";
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
  run,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";

afterEach(cleanupGateWorkspace);

/** Only qualified bytes enter the real gate CLI, with a separate ledger. */
const gateRun = (
  input: ProjectRun,
  qualification: { receipt: Uint8Array | null } | { receiptFile: string },
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
  if ("receiptFile" in qualification) {
    args.push("--receipt", qualification.receiptFile);
    expect(new Uint8Array(readFileSync(qualification.receiptFile))).toEqual(
      input.bytes
    );
  } else if (qualification.receipt) {
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

test("captured project runner bytes qualify through the committed policy and gate CLI", async () => {
  const input = await projectRun();
  const qualified = await collectCapturedGateReceipt(input, input.outputRoot);
  expect(qualified.status).toBe("ready");
  if (qualified.status !== "ready") {
    throw new Error(qualified.reason);
  }
  expect(qualified.capture).toEqual(input.capture);
  expect(new Uint8Array(readFileSync(qualified.receiptFile))).toEqual(
    input.bytes
  );
  const repeated = await collectCapturedGateReceipt(input, input.outputRoot);
  expect(repeated).toEqual({
    reason: "output-unavailable",
    status: "withheld",
  });
  expect(new Uint8Array(readFileSync(qualified.receiptFile))).toEqual(
    input.bytes
  );
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
  async (scenario) => {
    const input = await projectRun(
      scenario === "failed" ? "exit 17" : "exit 0"
    );
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

test("a changed admitted head stops before the isolated ledger is updated", async () => {
  const input = await projectRun();
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

test("a changed admitted base stops before the isolated ledger is updated", async () => {
  const input = await projectRun();
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

test("downloaded bytes differing from protected capture cannot qualify the gate", async () => {
  const input = await projectRun();
  const downloaded = new Uint8Array(input.bytes);
  downloaded[0] = 32;
  const result = await collectCapturedGateReceipt(
    input,
    input.outputRoot,
    downloaded
  );
  expect(result.status).toBe("withheld");
  if (result.status !== "withheld") {
    throw new Error("Changed artifact unexpectedly qualified");
  }
  expect(result.verification).toEqual({
    reason: "receipt-digest-mismatch",
    verified: false,
  });
  expect(result.reason).toBe("receipt-unqualified");
  const { ran } = gateRun(input, { receipt: null });
  expect(ran.exitCode).toBe(1);
  for (const name of VERIFICATION_GATES) {
    expect(gate(ran, name).codes).toEqual(["missing-evidence"]);
  }
});

test("an actual failed command stays blocked through the authenticated collector", async () => {
  const input = await projectRun("exit 17");
  expect(JSON.parse(new TextDecoder().decode(input.bytes))).toMatchObject({
    admission: "started",
    completion: "observed",
    exitCode: 17,
    outcome: "failed",
  });
  const result = await collectCapturedProject(input);
  expect(result).toEqual({ collected: false, reason: "job-nonpassing" });
  const { ran } = gateRun(input, { receipt: null });
  expect(ran.exitCode).toBe(1);
  for (const name of VERIFICATION_GATES) {
    expect(gate(ran, name).codes).toEqual(["missing-evidence"]);
  }
});
