import { qualifyBuildkiteGateReceipt } from "./buildkite-gate-receipt.ts";
import { buildkiteRepositoryMatches, buildkiteUuid } from "./buildkite-job.ts";
import { BUILDKITE_PROJECT_STEP } from "./buildkite-pipeline.ts";
import type {
  BuildkiteProjectAdmission,
  BuildkiteProjectCapture,
  BuildkiteProjectExpectation,
  BuildkiteProjectJob,
} from "./buildkite-project-receipt.ts";
import {
  downloadReceiptArtifact,
  selectReceiptArtifact,
} from "./buildkite-receipt-artifact.ts";
import {
  boundedBytes,
  CollectionStoppedError,
  stop,
} from "./buildkite-receipt-read.ts";
import { isRecord } from "./github-response.ts";

export interface CollectionInput {
  /** Independently authenticated admission, including the selected project job. */
  admission: BuildkiteProjectAdmission;
  organizationSlug: string;
  pipelineSlug: string;
  buildNumber: number;
  artifactPath: string;
  /** Exact HTTPS storage origins approved by the operator. No API token is sent there. */
  artifactOrigins: string[];
  capture: BuildkiteProjectCapture | null;
  expectation: BuildkiteProjectExpectation | null;
  readToken: string;
  request?: typeof fetch;
}

const MAX_RECORD_BYTES = 1024 * 1024;
const slug = (value: string) => /^[a-z0-9_-]+$/u.test(value);

const selectedJob = (
  build: unknown,
  input: CollectionInput
): BuildkiteProjectJob => {
  const { admission } = input;
  if (
    !isRecord(build) ||
    ![
      [build.id, admission.buildId],
      [build.number, input.buildNumber],
      [build.commit, admission.head],
      [build.source, "webhook"],
    ].every(([actual, expected]) => actual === expected) ||
    !["running", "passed", "failed"].includes(String(build.state)) ||
    !isRecord(build.pipeline) ||
    build.pipeline.id !== admission.pipelineId ||
    build.pipeline.slug !== input.pipelineSlug ||
    !buildkiteRepositoryMatches(
      build.pipeline.repository,
      admission.repository
    ) ||
    !isRecord(build.pull_request) ||
    build.pull_request.id !== String(admission.pullRequest) ||
    !buildkiteRepositoryMatches(
      build.pull_request.repository,
      admission.repository
    ) ||
    !Array.isArray(build.jobs)
  ) {
    return stop("build-mismatch");
  }
  // The default build API excludes retried executions. Never choose a success
  // from history or select a winner among parallel/matrix/duplicate step jobs.
  const jobs = build.jobs.filter(
    (job) => isRecord(job) && job.step_key === BUILDKITE_PROJECT_STEP
  );
  const [job] = jobs;
  if (
    jobs.length !== 1 ||
    !isRecord(job) ||
    ![
      [job.id, admission.jobId],
      [job.type, "script"],
      [job.cluster_queue_id, admission.queueId],
      [job.retried, false],
      [job.retried_in_job_id, null],
      [job.parallel_group_total, null],
      [job.matrix, null],
    ].every(([actual, expected]) => actual === expected) ||
    typeof job.soft_failed !== "boolean" ||
    typeof job.state !== "string" ||
    !(
      job.exit_status === null ||
      (typeof job.exit_status === "number" && Number.isInteger(job.exit_status))
    )
  ) {
    return stop("job-mismatch");
  }
  return {
    ...admission,
    exitStatus: job.exit_status,
    softFailed: job.soft_failed,
    state: job.state,
    stepKey: BUILDKITE_PROJECT_STEP,
    superseded: false,
    type: "script",
  };
};

const validateInput = (input: CollectionInput) => {
  const { admission } = input;
  if (
    !slug(input.organizationSlug) ||
    !slug(input.pipelineSlug) ||
    !Number.isSafeInteger(input.buildNumber) ||
    input.buildNumber < 1 ||
    !buildkiteUuid(admission.jobId) ||
    !input.artifactPath ||
    !/^[!-~]+$/u.test(input.readToken) ||
    input.artifactOrigins.some((origin) => {
      const url = new URL(origin);
      return (
        url.protocol !== "https:" ||
        url.origin !== origin ||
        !!url.username ||
        !!url.password
      );
    })
  ) {
    stop("input-invalid");
  }
};

/**
 * Reads one currently admitted attempt and its exact receipt artifact. Capture
 * authentication, PR rereads and protected gate-file custody remain the host's
 * responsibility. No credential discovery, writes, retries or status posting.
 */
export const collectBuildkiteReceipt = async (input: CollectionInput) => {
  const request = input.request ?? fetch;
  const { admission } = input;
  try {
    validateInput(input);
    const buildUrl = `https://api.buildkite.com/v2/organizations/${input.organizationSlug}/pipelines/${input.pipelineSlug}/builds/${input.buildNumber}`;
    const api = async (url: string, redirect: "error" | "manual" = "error") => {
      const response = await request(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.readToken}`,
        },
        redirect,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401 || response.status === 403) {
        return stop("read-denied");
      }
      return response;
    };
    const json = async (url: string) => {
      const response = await api(url);
      if (response.status !== 200 || response.redirected) {
        return stop("read-unavailable");
      }
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await boundedBytes(response, MAX_RECORD_BYTES)
        )
      );
      const next = (response.headers.get("Link") ?? "")
        .split(",")
        .some((link) => {
          const relation =
            /;\s*rel\s*=\s*(?:"(?<quoted>[^"]*)"|(?<plain>[^;\s]+))/u.exec(
              link
            );
          return (relation?.groups?.quoted ?? relation?.groups?.plain ?? "")
            .split(/\s+/u)
            .includes("next");
        });
      return { next, value };
    };
    const initialBuild = await json(buildUrl);
    const job = selectedJob(initialBuild.value, input);
    if (job.state !== "passed" || job.exitStatus !== 0 || job.softFailed) {
      return { collected: false as const, reason: "job-nonpassing" };
    }
    const artifactRoot = `${buildUrl}/jobs/${admission.jobId}/artifacts`;
    const artifact = await selectReceiptArtifact(
      json,
      artifactRoot,
      admission.jobId,
      input.artifactPath
    );
    const bytes = await downloadReceiptArtifact(
      api,
      request,
      artifactRoot,
      artifact,
      input.artifactOrigins
    );
    const currentBuild = await json(buildUrl);
    const current = selectedJob(currentBuild.value, input);
    if (JSON.stringify(job) !== JSON.stringify(current)) {
      return stop("job-changed");
    }
    return {
      artifactId: artifact.id,
      collected: true as const,
      job,
      ...qualifyBuildkiteGateReceipt({ ...input, bytes, job }),
    };
  } catch (error) {
    return {
      collected: false as const,
      reason:
        error instanceof CollectionStoppedError
          ? error.reason
          : "read-unavailable",
    };
  }
};
