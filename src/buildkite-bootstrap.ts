import { buildkitePipeline } from "./buildkite-pipeline.ts";
import {
  GitHubReadError,
  githubPullRequestReads,
} from "./github-pull-request-reads.ts";
import type { GitHubPullRequestReadsOptions } from "./github-pull-request-reads.ts";
import { parsePullRequest } from "./parse-github-pull-request.ts";

export const BUILDKITE_BOOTSTRAP_USAGE =
  "Usage: forge buildkite bootstrap --repository <owner/name> --pull-request <number> --commit <build-commit> --project-queue <queue> --trusted-queue <queue>";

/** Trusted host inputs. Build identity and the install must be authenticated before invocation. */
export interface BuildkiteBootstrapOptions {
  args: string[];
  token: string | undefined;
  fetch: GitHubPullRequestReadsOptions["fetch"];
}

const bootstrapArguments = (args: string[]) => {
  const values = new Map<string, string>();
  const flags = new Set([
    "--repository",
    "--pull-request",
    "--commit",
    "--project-queue",
    "--trusted-queue",
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !value || !flags.has(flag) || values.has(flag)) {
      return { diagnostic: BUILDKITE_BOOTSTRAP_USAGE, exitCode: 2 } as const;
    }
    values.set(flag, value);
  }
  const repository = values.get("--repository") ?? "";
  const number = values.get("--pull-request") ?? "";
  const commit = values.get("--commit") ?? "";
  const queueArgs = [
    "--project-queue",
    values.get("--project-queue") ?? "",
    "--trusted-queue",
    values.get("--trusted-queue") ?? "",
  ];
  if (
    !/^[1-9]\d*$/u.test(number) ||
    !Number.isSafeInteger(Number(number)) ||
    buildkitePipeline([...queueArgs, "--head", commit, "--base", commit]) ===
      null
  ) {
    return { diagnostic: BUILDKITE_BOOTSTRAP_USAGE, exitCode: 2 } as const;
  }
  return { commit, number: Number(number), queueArgs, repository };
};

/** Reads GitHub before producing the existing native graph; performs no upload or checkout. */
export const buildkiteBootstrap = async (
  options: BuildkiteBootstrapOptions
) => {
  const parsed = bootstrapArguments(options.args);
  if ("exitCode" in parsed) {
    return parsed;
  }
  const { commit, number, queueArgs, repository } = parsed;
  if (!options.token) {
    return {
      diagnostic: "GitHub read credential is required.",
      exitCode: 2,
    } as const;
  }
  try {
    const reads = githubPullRequestReads({
      fetch: options.fetch,
      maxPages: 1,
      pullRequest: number,
      repository,
      timeoutMs: 30_000,
      token: options.token,
    });
    const response = await reads.pullRequest();
    const pull = parsePullRequest(response.body);
    if (
      pull.number !== number ||
      pull.state !== "open" ||
      pull.merged ||
      pull.base.repositoryName.toLowerCase() !== repository.toLowerCase() ||
      pull.head.repositoryId !== pull.base.repositoryId ||
      pull.head.sha !== commit
    ) {
      return {
        diagnostic: "Pull request admission refused.",
        exitCode: 3,
      } as const;
    }
    const pipeline = buildkitePipeline([
      ...queueArgs,
      "--head",
      pull.head.sha,
      "--base",
      pull.base.sha,
    ]);
    if (pipeline === null) {
      return {
        diagnostic: "Pull request admission failed.",
        exitCode: 3,
      } as const;
    }
    return { exitCode: 0, pipeline } as const;
  } catch (error) {
    if (error instanceof GitHubReadError && error.code === "options-invalid") {
      return { diagnostic: BUILDKITE_BOOTSTRAP_USAGE, exitCode: 2 } as const;
    }
    return {
      diagnostic: "Pull request admission could not be established.",
      exitCode: 3,
    } as const;
  }
};
