import { buildkiteUuid, fullCommit } from "./buildkite-job.ts";
import { BUILDKITE_PROJECT_STEP } from "./buildkite-pipeline.ts";
import { digest } from "./check-config.ts";
import type { CheckEvidence } from "./evidence-types.ts";
import { isRecord } from "./github-response.ts";
import { normalizeCheckReceipts } from "./normalize-check-receipts.ts";
import type { CheckReceiptExpectation } from "./normalize-check-receipts.ts";

interface ProjectJobIdentity {
  organizationId: string;
  pipelineId: string;
  buildId: string;
  jobId: string;
  queueId: string;
  repository: string;
  pullRequest: number;
  head: string;
}

export interface BuildkiteProjectAdmission extends ProjectJobIdentity {
  base: string;
}

/** Normalized by trusted collection from the authenticated build/job records. */
export interface BuildkiteProjectJob extends ProjectJobIdentity {
  stepKey: string;
  type: string;
  state: string;
  exitStatus: number | null;
  softFailed: boolean;
  superseded: boolean;
}

/** Recorded outside the project account, from the protected runner's stdout. */
export interface BuildkiteProjectCapture {
  jobId: string;
  receiptSha256: string;
  runnerExitCode: number;
}

type ProjectReceiptResult =
  | { verified: true; checks: CheckEvidence[] }
  | {
      verified: false;
      reason:
        | "admission-invalid"
        | "job-mismatch"
        | "job-nonpassing"
        | "capture-mismatch"
        | "receipt-unavailable"
        | "receipt-digest-mismatch"
        | "receipt-invalid"
        | "receipt-subject-mismatch"
        | "receipt-nonpassing";
    };

const JOB_ID_FIELDS = [
  "organizationId",
  "pipelineId",
  "buildId",
  "jobId",
  "queueId",
] as const;
const JOB_IDENTITY_FIELDS = [
  ...JOB_ID_FIELDS,
  "repository",
  "pullRequest",
  "head",
] as const;
const MAX_RECEIPT_BYTES = 64 * 1024;
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

const validAdmission = (admission: BuildkiteProjectAdmission) =>
  JOB_ID_FIELDS.every((field) => buildkiteUuid(admission[field])) &&
  /^[\w.-]+\/[\w.-]+$/u.test(admission.repository) &&
  Number.isSafeInteger(admission.pullRequest) &&
  admission.pullRequest > 0 &&
  fullCommit(admission.head) &&
  fullCommit(admission.base);

const matchingSource = (
  source: unknown,
  admission: BuildkiteProjectAdmission
) =>
  isRecord(source) &&
  source.head === admission.head &&
  source.base === admission.base;

const readReceipt = (
  bytes: Uint8Array,
  admission: BuildkiteProjectAdmission,
  expectation: Omit<CheckReceiptExpectation, "pullRequest">
): ProjectReceiptResult => {
  let receipt: unknown;
  try {
    receipt = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
  } catch {
    return { reason: "receipt-invalid", verified: false };
  }
  const { checks, rejected } = normalizeCheckReceipts([receipt], {
    ...expectation,
    pullRequest: admission.pullRequest,
  });
  if (!isRecord(receipt) || rejected.length > 0) {
    return { reason: "receipt-invalid", verified: false };
  }
  if (
    receipt.repository !== admission.repository ||
    !matchingSource(receipt.sourceBefore, admission) ||
    !matchingSource(receipt.sourceAfter, admission)
  ) {
    return { reason: "receipt-subject-mismatch", verified: false };
  }
  if (
    !sha256(receipt.configBefore) ||
    receipt.configBefore !== receipt.configAfter ||
    checks.length === 0 ||
    checks.some(({ state }) => state !== "passed")
  ) {
    return { reason: "receipt-nonpassing", verified: false };
  }
  return { checks, verified: true };
};

/**
 * Correlates already authenticated observations; the artifact supplies only
 * bytes, never the expected job, digest or producer. No I/O or status writes.
 */
export const verifyBuildkiteProjectReceipt = ({
  admission,
  job,
  capture,
  bytes,
  expectation,
}: {
  admission: BuildkiteProjectAdmission;
  job: BuildkiteProjectJob | null;
  capture: BuildkiteProjectCapture | null;
  bytes: Uint8Array | null;
  expectation: Omit<CheckReceiptExpectation, "pullRequest">;
}): ProjectReceiptResult => {
  if (!validAdmission(admission)) {
    return { reason: "admission-invalid", verified: false };
  }
  if (
    !job ||
    job.type !== "script" ||
    job.stepKey !== BUILDKITE_PROJECT_STEP ||
    JOB_IDENTITY_FIELDS.some((field) => job[field] !== admission[field])
  ) {
    return { reason: "job-mismatch", verified: false };
  }
  if (
    job.state !== "passed" ||
    job.exitStatus !== 0 ||
    job.softFailed !== false ||
    job.superseded !== false
  ) {
    return { reason: "job-nonpassing", verified: false };
  }
  if (
    !capture ||
    capture.jobId !== admission.jobId ||
    capture.runnerExitCode !== 0 ||
    !sha256(capture.receiptSha256)
  ) {
    return { reason: "capture-mismatch", verified: false };
  }
  if (!bytes?.byteLength || bytes.byteLength > MAX_RECEIPT_BYTES) {
    return { reason: "receipt-unavailable", verified: false };
  }
  if (digest(bytes) !== capture.receiptSha256) {
    return { reason: "receipt-digest-mismatch", verified: false };
  }
  return readReceipt(bytes, admission, expectation);
};
