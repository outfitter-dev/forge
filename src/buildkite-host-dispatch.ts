import { realpathSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  authenticateBuildkiteBootstrap,
  BUILDKITE_OIDC_AUDIENCE,
  BuildkiteBuildError,
  buildkiteUuid,
  fullCommit,
} from "./buildkite-job.ts";
import type { BuildkiteJobPolicy } from "./buildkite-job.ts";
import { isRecord } from "./github-response.ts";

const TIMEOUT_MS = 45_000;
const MAX_STDOUT = 64 * 1024;
const safePath = (value: unknown): value is string =>
  typeof value === "string" &&
  path.isAbsolute(value) &&
  !value.includes(":") &&
  ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32);
const slug = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9_-]+$/u.test(value);
const queue = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]+$/u.test(value);
const repositoryName = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(value) &&
  !value.split("/").some((part) => part === "." || part === "..") &&
  !value.endsWith(".git");

interface HostConfiguration extends BuildkiteJobPolicy {
  agent: string;
  bun: string;
  install: string;
  installCommit: string;
  verifier: string;
  projectQueue: string;
}

interface Command {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  input?: string;
}

const parseConfiguration = (value: unknown): HostConfiguration => {
  if (!isRecord(value)) {
    throw new Error("Invalid Forge host configuration.");
  }
  const {
    agent,
    bun,
    install,
    installCommit,
    organizationId,
    organizationSlug,
    pipelineId,
    pipelineSlug,
    projectQueue,
    queueId,
    repository,
    trustedQueue,
    verifier,
  } = value;
  if (
    !safePath(agent) ||
    !safePath(bun) ||
    !safePath(install) ||
    !safePath(verifier) ||
    !fullCommit(installCommit) ||
    !buildkiteUuid(organizationId) ||
    !buildkiteUuid(pipelineId) ||
    !buildkiteUuid(queueId) ||
    !slug(organizationSlug) ||
    !slug(pipelineSlug) ||
    !queue(projectQueue) ||
    !queue(trustedQueue) ||
    projectQueue.toLowerCase() === trustedQueue.toLowerCase() ||
    !repositoryName(repository)
  ) {
    throw new Error("Invalid Forge host configuration.");
  }
  return {
    agent,
    bun,
    install,
    installCommit,
    organizationId,
    organizationSlug,
    pipelineId,
    pipelineSlug,
    projectQueue,
    queueId,
    repository,
    trustedQueue,
    verifier,
  };
};

const externalTo = (install: string, entry: string): boolean => {
  const relative = path.relative(install, realpathSync(entry));
  return relative === ".." || relative.startsWith(`..${path.sep}`);
};

export const runCommand = async (
  { argv, cwd, env, input }: Command,
  timeoutMs = TIMEOUT_MS
): Promise<string> => {
  const child = Bun.spawn(argv, {
    cwd,
    detached: true,
    env,
    killSignal: "SIGKILL",
    maxBuffer: MAX_STDOUT,
    stderr: "ignore",
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
  });
  const timer = new AbortController();
  const deadline = delay(timeoutMs, undefined, { signal: timer.signal }).then(
    () => {
      throw new Error("Host command timed out.");
    }
  );
  let canceled = false;
  const cancel = () => {
    canceled = true;
    timer.abort();
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    const [status, stdout] = await Promise.race([
      Promise.all([child.exited, child.stdout.bytes()]),
      deadline,
    ]);
    if (canceled || status !== 0 || stdout.byteLength > MAX_STDOUT) {
      throw new Error("Host command failed.");
    }
    return new TextDecoder().decode(stdout);
  } catch (error) {
    // Descendants can keep stdout open after the verifier shell exits.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (killError) {
      if (!isRecord(killError) || killError.code !== "ESRCH") {
        throw killError;
      }
    }
    throw error;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    timer.abort();
  }
};

type Environment = Record<string, string | undefined>;

const dispatch = async (
  policy: HostConfiguration,
  cwd: string,
  env: Environment,
  command: typeof runCommand,
  request: typeof fetch
): Promise<string | null> => {
  const jobId = env.BUILDKITE_JOB_ID;
  const jobToken = env.BUILDKITE_AGENT_ACCESS_TOKEN;
  const readToken = env.FORGE_BUILDKITE_READ_TOKEN;
  const gitHubToken = env.FORGE_GITHUB_TOKEN;
  if (
    Object.keys(env).includes("BUN_CONFIG_VERBOSE_FETCH") ||
    !buildkiteUuid(jobId) ||
    !jobToken ||
    !readToken ||
    !gitHubToken
  ) {
    return "Forge host job inputs are invalid.";
  }
  const clean = {
    HOME: cwd,
    PATH: `${path.dirname(policy.bun)}:/usr/bin:/bin`,
  };
  let failure = "Forge trusted install verification failed.";
  try {
    await command({
      argv: [
        "/bin/bash",
        policy.verifier,
        "--install",
        policy.install,
        "--repository",
        policy.repository,
        "--commit",
        policy.installCommit,
      ],
      cwd,
      env: clean,
    });
    failure = "Forge could not authenticate the Buildkite bootstrap job.";
    const agentEnv = {
      ...clean,
      BUILDKITE_AGENT_ACCESS_TOKEN: jobToken,
      BUILDKITE_JOB_ID: jobId,
    };
    const token = await command({
      argv: [
        policy.agent,
        "oidc",
        "request-token",
        "--audience",
        BUILDKITE_OIDC_AUDIENCE,
        "--claim",
        "queue_id,queue_key",
        "--lifetime",
        "120",
        "--skip-redaction",
      ],
      cwd,
      env: agentEnv,
    });
    const admitted = await authenticateBuildkiteBootstrap(
      policy,
      jobId,
      token.trim(),
      readToken,
      request
    );
    failure = "Forge could not admit the Buildkite pull request.";
    const pipeline = await command({
      argv: [
        policy.bun,
        "--no-env-file",
        "--no-install",
        "src/forge-cli.ts",
        "buildkite",
        "bootstrap",
        "--repository",
        policy.repository,
        "--pull-request",
        admitted.pullRequest,
        "--commit",
        admitted.commit,
        "--project-queue",
        policy.projectQueue,
        "--trusted-queue",
        policy.trustedQueue,
      ],
      cwd: policy.install,
      env: { ...clean, FORGE_GITHUB_TOKEN: gitHubToken },
    });
    if (!pipeline.trim()) {
      return failure;
    }
    failure = "Forge could not upload the admitted Buildkite graph.";
    if (Date.now() >= admitted.expiresAt * 1000) {
      return failure;
    }
    await command({
      argv: [
        policy.agent,
        "pipeline",
        "upload",
        "--no-interpolation",
        "--reject-parse-warnings",
      ],
      cwd,
      env: agentEnv,
      input: pipeline,
    });
    return null;
  } catch (error) {
    return error instanceof BuildkiteBuildError ? error.message : failure;
  }
};

export const buildkiteHostDispatch = async (
  args: string[],
  env: Environment,
  command = runCommand,
  request = fetch
): Promise<string | null> => {
  const [config] = args;
  if (args.length !== 1 || !safePath(config)) {
    return "Forge requires an absolute host configuration path.";
  }
  try {
    const policy = parseConfiguration(await Bun.file(config).json());
    const install = realpathSync(policy.install);
    const cwd = path.dirname(realpathSync(config));
    if (
      ![
        cwd,
        policy.verifier,
        policy.bun,
        path.dirname(policy.bun),
        policy.agent,
      ].every((entry) => externalTo(install, entry))
    ) {
      return "Forge host configuration and tools must be outside the install.";
    }
    if (policy.bun !== path.join(path.dirname(policy.bun), "bun")) {
      return "Forge requires the host Bun executable to be named bun.";
    }
    return await dispatch(policy, cwd, env, command, request);
  } catch {
    return "Forge host configuration could not be loaded.";
  }
};

if (import.meta.main) {
  const failure = await buildkiteHostDispatch(Bun.argv.slice(2), process.env);
  if (failure !== null) {
    console.error(failure);
    process.exitCode = 1;
  }
}
