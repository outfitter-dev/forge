import { afterAll, beforeAll, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readBuildkiteProjectCapture } from "../src/buildkite-capture-store.ts";
import { captureBuildkiteProjectCheck } from "../src/buildkite-project-capture.ts";
import { digest } from "../src/check-config.ts";
import { collectBuildkiteReceipt } from "../src/collect-buildkite-receipt.ts";
import { parseGatePolicy } from "../src/gate-policy.ts";
import { fixture, gitFixture } from "./check-fixtures.ts";
import { PULL_REQUEST } from "./gate-fixtures.ts";
import { root } from "./gate-test-harness.ts";

export const repository = "outfitter-dev/forge";
export const policyFile = path.join(root, "forge-gate.json");
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
afterAll(() => {
  for (const directory of temporary) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const uuid = (digit: number) => `00000000-0000-4000-8000-00000000000${digit}`;

/** Executes a real disposable project. Buildkite identity and custody are fixtures. */
export const projectRun = async (script = "exit 0") => {
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
  const captureRoot = mkdtempSync(
    path.join(tmpdir(), "forge-protected-capture-")
  );
  temporary.push(captureRoot);
  const captured = await captureBuildkiteProjectCheck({
    base,
    captureRoot,
    head,
    jobId: uuid(2),
    launcher: "/usr/bin/env",
    projectRoot: project,
    repository,
    runner: executable,
    timeoutMs: 10_000,
    toolBin: path.dirname(process.execPath),
  });
  expect(captured.status).toBe("captured");
  if (captured.status !== "captured") {
    throw new Error(captured.reason);
  }
  const bytes = new Uint8Array(readFileSync(captured.receiptFile));
  const capture = await readBuildkiteProjectCapture(captureRoot, uuid(2));
  expect(capture).toEqual(captured.capture);
  if (!capture) {
    throw new Error("Protected capture was unavailable");
  }
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
    capture,
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
      exitStatus: capture.runnerExitCode,
      softFailed: false,
      state: capture.runnerExitCode === 0 ? "passed" : "failed",
      stepKey: "forge-check",
      superseded: false,
      type: "script",
    },
  };
};

export type ProjectRun = Awaited<ReturnType<typeof projectRun>>;

/** Buildkite and artifact custody are controlled transports around real capture bytes. */
export const collectCapturedProject = (
  input: ProjectRun,
  downloaded = input.bytes
) => {
  const { admission, capture, expectation, job } = input;
  const buildUrl =
    "https://api.buildkite.com/v2/organizations/example/pipelines/forge/builds/1";
  const artifactRoot = `${buildUrl}/jobs/${admission.jobId}/artifacts`;
  const artifactId = uuid(6);
  const storage = "https://artifact.example/receipt";
  const reads: string[] = [];
  const request: typeof fetch = Object.assign(
    // oxlint-disable-next-line require-await -- Controlled fetch returns the same async interface without network I/O.
    async (target: string | URL | Request, init?: RequestInit) => {
      const url = String(target);
      reads.push(url);
      if (url === storage) {
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
        return new Response(downloaded);
      }
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer fixture-read-token"
      );
      if (url === buildUrl) {
        return Response.json({
          commit: admission.head,
          id: admission.buildId,
          jobs: [
            {
              cluster_queue_id: job.queueId,
              exit_status: job.exitStatus,
              id: job.jobId,
              matrix: null,
              parallel_group_total: null,
              retried: false,
              retried_in_job_id: null,
              soft_failed: job.softFailed,
              state: job.state,
              step_key: job.stepKey,
              type: job.type,
            },
          ],
          number: 1,
          pipeline: {
            id: admission.pipelineId,
            repository: `https://github.com/${repository}`,
            slug: "forge",
          },
          pull_request: {
            id: String(admission.pullRequest),
            repository: `https://github.com/${repository}`,
          },
          source: "webhook",
          state: "running",
        });
      }
      if (url === `${artifactRoot}?per_page=100&page=1`) {
        return Response.json([
          {
            file_size: downloaded.byteLength,
            id: artifactId,
            job_id: job.jobId,
            path: "receipt.json",
            state: "finished",
          },
        ]);
      }
      if (url === `${artifactRoot}/${artifactId}/download`) {
        return new Response(null, {
          headers: { Location: storage },
          status: 302,
        });
      }
      throw new Error(`Unexpected controlled request ${url}`);
    },
    { preconnect: fetch.preconnect }
  );
  return collectBuildkiteReceipt({
    admission,
    artifactOrigins: ["https://artifact.example"],
    artifactPath: "receipt.json",
    buildNumber: 1,
    capture,
    expectation,
    organizationSlug: "example",
    pipelineSlug: "forge",
    readToken: "fixture-read-token",
    request,
  }).then((result) => {
    if (result.collected) {
      expect(reads.filter((url) => url === buildUrl)).toHaveLength(2);
    }
    return result;
  });
};
