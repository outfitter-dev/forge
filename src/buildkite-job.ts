import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { JWTPayload } from "jose";

import { isRecord } from "./github-response.ts";

export const BUILDKITE_OIDC_AUDIENCE = "forge-buildkite-bootstrap";
const ISSUER = "https://agent.buildkite.com";
const BOOTSTRAP_STEP = "forge-bootstrap";
const TIMEOUT_MS = 15_000;

const buildReadDiagnostics = {
  denied: "Forge was denied access to the Buildkite build record.",
  mismatch:
    "Forge Buildkite build record did not match the signed job or identify an eligible PR.",
  unavailable: "Forge could not read the Buildkite build record.",
};

export class BuildkiteBuildError extends Error {
  constructor(reason: keyof typeof buildReadDiagnostics) {
    super(buildReadDiagnostics[reason]);
    this.name = "BuildkiteBuildError";
  }
}

export const buildkiteUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value);

export const fullCommit = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);

export interface BuildkiteJobPolicy {
  organizationId: string;
  organizationSlug: string;
  pipelineId: string;
  pipelineSlug: string;
  queueId: string;
  repository: string;
  trustedQueue: string;
}

const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const repositoryMatches = (value: unknown, repository: string): boolean =>
  typeof value === "string" &&
  [
    `https://github.com/${repository}`,
    `git@github.com:${repository}`,
    `git://github.com/${repository}`,
  ].some((url) => value === url || value === `${url}.git`);

const bootstrapIdentity = (
  claims: JWTPayload,
  policy: BuildkiteJobPolicy,
  jobId: string
) => {
  if (
    claims.organization_id !== policy.organizationId ||
    claims.organization_slug !== policy.organizationSlug ||
    claims.pipeline_id !== policy.pipelineId ||
    claims.pipeline_slug !== policy.pipelineSlug ||
    claims.queue_id !== policy.queueId ||
    claims.queue_key !== policy.trustedQueue ||
    claims.step_key !== BOOTSTRAP_STEP ||
    claims.job_id !== jobId ||
    claims.runner_environment !== "self-hosted" ||
    claims.build_source !== "webhook" ||
    !buildkiteUuid(claims.build_id) ||
    !positiveInteger(claims.build_number) ||
    !fullCommit(claims.build_commit) ||
    typeof claims.exp !== "number"
  ) {
    throw new Error("Unexpected Buildkite bootstrap job.");
  }
  return {
    buildId: claims.build_id,
    buildNumber: claims.build_number,
    commit: claims.build_commit,
    expiresAt: claims.exp,
  };
};

type BootstrapIdentity = ReturnType<typeof bootstrapIdentity>;

const readBuild = async (
  identity: BootstrapIdentity,
  policy: BuildkiteJobPolicy,
  readToken: string,
  request: typeof fetch
): Promise<unknown> => {
  try {
    const response = await request(
      `https://api.buildkite.com/v2/organizations/${policy.organizationSlug}/pipelines/${policy.pipelineSlug}/builds/${identity.buildNumber}`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${readToken}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    if (response.status === 401 || response.status === 403) {
      throw new BuildkiteBuildError("denied");
    }
    if (response.redirected || response.status !== 200) {
      throw new BuildkiteBuildError("unavailable");
    }
    return await response.json();
  } catch (error) {
    throw error instanceof BuildkiteBuildError
      ? error
      : new BuildkiteBuildError("unavailable");
  }
};

const verifyRunningJob = (
  buildJobs: unknown[],
  policy: BuildkiteJobPolicy,
  jobId: string
) => {
  const jobs = buildJobs.filter((job) => isRecord(job) && job.id === jobId);
  const [job] = jobs;
  if (
    jobs.length !== 1 ||
    !isRecord(job) ||
    job.type !== "script" ||
    job.step_key !== BOOTSTRAP_STEP ||
    job.cluster_queue_id !== policy.queueId ||
    job.state !== "running"
  ) {
    throw new BuildkiteBuildError("mismatch");
  }
};

const readPullRequest = (
  build: unknown,
  identity: BootstrapIdentity,
  policy: BuildkiteJobPolicy,
  jobId: string
) => {
  if (
    !isRecord(build) ||
    build.id !== identity.buildId ||
    build.number !== identity.buildNumber ||
    build.commit !== identity.commit ||
    build.source !== "webhook" ||
    build.state !== "running" ||
    !isRecord(build.pipeline) ||
    build.pipeline.id !== policy.pipelineId ||
    build.pipeline.slug !== policy.pipelineSlug ||
    !repositoryMatches(build.pipeline.repository, policy.repository) ||
    !Array.isArray(build.jobs)
  ) {
    throw new BuildkiteBuildError("mismatch");
  }
  verifyRunningJob(build.jobs, policy, jobId);
  const pullRequest = build.pull_request;
  if (
    !isRecord(pullRequest) ||
    !repositoryMatches(pullRequest.repository, policy.repository) ||
    typeof pullRequest.id !== "string" ||
    !/^[1-9]\d*$/u.test(pullRequest.id) ||
    !positiveInteger(Number(pullRequest.id))
  ) {
    throw new BuildkiteBuildError("mismatch");
  }
  return pullRequest.id;
};

export const authenticateBuildkiteBootstrap = async (
  policy: BuildkiteJobPolicy,
  jobId: string,
  token: string,
  readToken: string,
  request: typeof fetch
) => {
  const keys = createRemoteJWKSet(new URL("/.well-known/jwks", ISSUER), {
    [customFetch]: (url, init) => request(url, { ...init, redirect: "error" }),
    timeoutDuration: TIMEOUT_MS,
  });
  const { payload: claims } = await jwtVerify(token, keys, {
    algorithms: ["RS256"],
    audience: BUILDKITE_OIDC_AUDIENCE,
    issuer: ISSUER,
    maxTokenAge: "2m",
    requiredClaims: ["exp", "nbf"],
  });
  const identity = bootstrapIdentity(claims, policy, jobId);
  const build = await readBuild(identity, policy, readToken, request);
  return {
    commit: identity.commit,
    expiresAt: identity.expiresAt,
    pullRequest: readPullRequest(build, identity, policy, jobId),
  };
};
