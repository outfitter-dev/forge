/** Native Buildkite command steps for the two FOR-38 execution lanes. */
export const BUILDKITE_PIPELINE_USAGE =
  "Usage: forge buildkite pipeline --project-queue <queue> --trusted-queue <queue> --head <commit-oid> --base <commit-oid>";

const MISSING_HOOK =
  "echo 'Forge Buildkite command hook is required.' >&2; exit 1";

/**
 * The trusted bootstrap supplies queue names and admitted head/base pins.
 * Host hooks validate identity and own execution.
 */
export const buildkitePipeline = (args: string[]) => {
  const values = new Map<string, string>();
  const flags = new Set([
    "--project-queue",
    "--trusted-queue",
    "--head",
    "--base",
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !flag ||
      !flags.has(flag) ||
      values.has(flag) ||
      !value ||
      !(flag === "--head" || flag === "--base"
        ? /^[\da-f]{40}$/u.test(value)
        : /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(value))
    ) {
      return null;
    }
    values.set(flag, value);
  }
  const projectQueue = values.get("--project-queue");
  const trustedQueue = values.get("--trusted-queue");
  const head = values.get("--head");
  const base = values.get("--base");
  if (!(projectQueue && trustedQueue && head && base)) {
    return null;
  }
  return {
    steps: [
      {
        agents: { queue: projectQueue, role: "project" },
        checkout: { skip: true },
        command: MISSING_HOOK,
        env: {
          FORGE_BASE_SHA: base,
          FORGE_BUILDKITE_TASK: "check",
          FORGE_HEAD_SHA: head,
        },
        key: "forge-check",
        label: "Forge check",
      },
      {
        agents: { queue: trustedQueue, role: "trusted" },
        allow_dependency_failure: true,
        checkout: { skip: true },
        command: MISSING_HOOK,
        depends_on: ["forge-check"],
        env: {
          FORGE_BASE_SHA: base,
          FORGE_BUILDKITE_TASK: "gate",
          FORGE_HEAD_SHA: head,
        },
        key: "forge-gate",
        label: "Forge gate",
      },
    ],
  };
};
