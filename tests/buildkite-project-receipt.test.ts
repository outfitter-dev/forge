import { expect, test } from "bun:test";

import type {
  BuildkiteProjectAdmission,
  BuildkiteProjectCapture,
  BuildkiteProjectJob,
} from "../src/buildkite-project-receipt.ts";
import { verifyBuildkiteProjectReceipt } from "../src/buildkite-project-receipt.ts";
import { digest } from "../src/check-config.ts";
import type { CheckSource } from "../src/check-types.ts";
import { VERIFICATION_GATES } from "../src/evidence-types.ts";
import { BASE, HEAD, REPOSITORY } from "./evidence-fixtures.ts";

const uuid = (digit: number) => `00000000-0000-4000-8000-00000000000${digit}`;
const admission: BuildkiteProjectAdmission = {
  base: BASE,
  buildId: uuid(1),
  head: HEAD,
  jobId: uuid(2),
  organizationId: uuid(3),
  pipelineId: uuid(4),
  pullRequest: 12,
  queueId: uuid(5),
  repository: REPOSITORY,
};
const { base, ...jobIdentity } = admission;
const job: BuildkiteProjectJob = {
  ...jobIdentity,
  exitStatus: 0,
  softFailed: false,
  state: "passed",
  stepKey: "forge-check",
  superseded: false,
  type: "script",
};
const source: CheckSource = {
  base,
  coverage: "tracked-and-nonignored-untracked",
  dirty: false,
  head: HEAD,
  indexDigest: "8".repeat(64),
  mergeBase: BASE,
  tree: "c".repeat(40),
  untracked: 0,
  worktreeDigest: "9".repeat(64),
};
const runtime = { arch: "x64", bun: "1.4.4", platform: "linux" };
const receipt = {
  admission: "started",
  cancellation: null,
  check: { commandDigest: "a".repeat(64), id: "check" },
  completion: "observed",
  configAfter: "b".repeat(64),
  configBefore: "b".repeat(64),
  evidence: "stable",
  exitCode: 0,
  finishedAt: "2026-01-01T00:00:02.000Z",
  kind: "forge-check",
  outcome: "passed",
  receiptId: "receipt-1",
  recording: { state: "persisted" },
  repository: REPOSITORY,
  runtime,
  schemaVersion: 1,
  sourceAfter: source,
  sourceBefore: source,
};
const encoded = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const captured = (bytes: Uint8Array): BuildkiteProjectCapture => ({
  jobId: admission.jobId,
  receiptSha256: digest(bytes),
  runnerExitCode: 0,
});
const bytes = encoded(receipt);
const input = {
  admission,
  bytes,
  capture: captured(bytes),
  expectation: {
    checks: { build: "check", lint: "check", test: "check" },
    commandDigest: "a".repeat(64),
    configDigest: "b".repeat(64),
    provenance: {
      producer: "protected-project-runner",
      runtimeFingerprint: "f".repeat(64),
    },
    runtime,
  },
  job,
};

const verify = (
  overrides: Partial<Parameters<typeof verifyBuildkiteProjectReceipt>[0]>
) => verifyBuildkiteProjectReceipt({ ...input, ...overrides });

test("matching authenticated job and protected capture yield passing checks for the admitted PR", () => {
  expect(verify({})).toEqual({
    checks: VERIFICATION_GATES.map((name) => ({
      name,
      provenance: { ...input.expectation.provenance, runId: receipt.receiptId },
      state: "passed",
      subject: {
        baseSha: BASE,
        headSha: HEAD,
        id: admission.pullRequest,
        kind: "pull_request",
        repository: REPOSITORY,
      },
    })),
    verified: true,
  });
});

test("a symbolic admission pin cannot yield evidence", () => {
  expect(verify({ admission: { ...admission, base: "main" } })).toEqual({
    reason: "admission-invalid",
    verified: false,
  });
});

test.each([
  { organizationId: uuid(9) },
  { pipelineId: uuid(9) },
  { buildId: uuid(9) },
  { jobId: uuid(9) },
  { queueId: uuid(9) },
  { repository: "fixture/other" },
  { pullRequest: 13 },
  { head: "f".repeat(40) },
  { stepKey: "forge-gate" },
  { type: "trigger" },
])("rejects a different job identity: %j", (override) => {
  expect(verify({ job: { ...job, ...override } })).toEqual({
    reason: "job-mismatch",
    verified: false,
  });
});

test.each([
  { state: "running" },
  { state: "failed" },
  { state: "canceled" },
  { exitStatus: null },
  { exitStatus: 1 },
  { softFailed: true },
  { superseded: true },
])(
  "a nonqualifying Buildkite job cannot yield passing evidence: %j",
  (override) => {
    expect(verify({ job: { ...job, ...override } })).toEqual({
      reason: "job-nonpassing",
      verified: false,
    });
  }
);

test("reports missing job and capture observations separately", () => {
  expect(verify({ job: null })).toEqual({
    reason: "job-mismatch",
    verified: false,
  });
  expect(verify({ capture: null })).toEqual({
    reason: "capture-mismatch",
    verified: false,
  });
});

test.each([{ jobId: uuid(9) }, { receiptSha256: "" }, { runnerExitCode: 1 }])(
  "requires a protected successful capture for this job: %j",
  (override) => {
    expect(verify({ capture: { ...input.capture, ...override } })).toEqual({
      reason: "capture-mismatch",
      verified: false,
    });
  }
);

test("the exact artifact bytes must match the protected capture", () => {
  const reformatted = new TextEncoder().encode(`${JSON.stringify(receipt)}\n`);
  expect(verify({ bytes: reformatted })).toEqual({
    reason: "receipt-digest-mismatch",
    verified: false,
  });
});

test.each([null, new Uint8Array(), new Uint8Array(64 * 1024 + 1)])(
  "rejects an unavailable, empty or oversized artifact",
  (artifact) => {
    expect(verify({ bytes: artifact })).toEqual({
      reason: "receipt-unavailable",
      verified: false,
    });
  }
);

test.each([
  encoded(null),
  encoded({ schemaVersion: 2 }),
  new Uint8Array([255]),
])(
  "rejects unsupported or unreadable receipts even when captured",
  (artifact) => {
    expect(verify({ bytes: artifact, capture: captured(artifact) })).toEqual({
      reason: "receipt-invalid",
      verified: false,
    });
  }
);

test.each([
  { repository: "fixture/other" },
  { sourceBefore: { ...source, base: "f".repeat(40) } },
  { sourceAfter: { ...source, head: "f".repeat(40) } },
])(
  "requires repository and both revision observations to match admission: %j",
  (override) => {
    const artifact = encoded({ ...receipt, ...override });
    expect(verify({ bytes: artifact, capture: captured(artifact) })).toEqual({
      reason: "receipt-subject-mismatch",
      verified: false,
    });
  }
);

test.each([
  { evidence: "unknown" },
  { outcome: "failed" },
  { recording: { state: "failed" } },
  { sourceAfter: { ...source, dirty: true } },
])("does not promote incomplete or nonpassing receipts: %j", (override) => {
  const artifact = encoded({ ...receipt, ...override });
  expect(verify({ bytes: artifact, capture: captured(artifact) })).toEqual({
    checks: [],
    reason: "receipt-nonpassing",
    verified: true,
  });
});

test.each([
  null,
  { ...input.expectation, commandDigest: "" },
  { ...input.expectation, configDigest: "" },
  { ...input.expectation, runtime: { ...runtime, bun: "" } },
])(
  "a bound receipt stays an observation without complete trusted pins",
  (expectation) => {
    expect(verify({ expectation })).toEqual({
      checks: [],
      reason: "expectation-unavailable",
      verified: true,
    });
  }
);

test.each([
  "fixture-runtime",
  "F".repeat(64),
  "g".repeat(64),
  `${"f".repeat(63)}\n`,
])(
  "a malformed runtime fingerprint yields no passing evidence",
  (runtimeFingerprint) => {
    expect(
      verify({
        expectation: {
          ...input.expectation,
          provenance: { ...input.expectation.provenance, runtimeFingerprint },
        },
      })
    ).toEqual({
      checks: [],
      reason: "expectation-unavailable",
      verified: true,
    });
  }
);

test.each([
  { check: { ...receipt.check, commandDigest: "c".repeat(64) } },
  { configAfter: "c".repeat(64) },
  { configBefore: null },
  { configAfter: "c".repeat(64), configBefore: "c".repeat(64) },
  { runtime: null },
  { runtime: { ...runtime, arch: "arm64" } },
  { runtime: { ...runtime, bun: "1.4.5" } },
  { runtime: { ...runtime, platform: "darwin" } },
])(
  "a bound receipt stays an observation when execution pins differ: %j",
  (override) => {
    const artifact = encoded({ ...receipt, ...override });
    expect(verify({ bytes: artifact, capture: captured(artifact) })).toEqual({
      checks: [],
      reason: "receipt-execution-mismatch",
      verified: true,
    });
  }
);
