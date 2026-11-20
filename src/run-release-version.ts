import { readFile } from "node:fs/promises";

import { evaluateReleaseVersion } from "./evaluate-release-version.ts";
import type {
  ReleaseVersionDecision,
  ReleaseVersionInput,
  ReleaseVersionPolicy,
} from "./release-version-types.ts";

export const RELEASE_VERSION_SYNOPSIS =
  "forge release version <versions.json> --policy <policy.json>";

interface ReleaseVersionInputError {
  diagnostic: string;
  kind: "forge-release-version-input-error";
  schemaVersion: 1;
}

const inputError = (diagnostic: string): ReleaseVersionInputError => ({
  diagnostic,
  kind: "forge-release-version-input-error",
  schemaVersion: 1,
});

export const runReleaseVersion = async (
  args: string[]
): Promise<ReleaseVersionDecision | ReleaseVersionInputError> => {
  const [operation, inputPath, flag, policyPath] = args;
  if (
    args.length !== 4 ||
    operation !== "version" ||
    !inputPath ||
    inputPath.startsWith("--") ||
    flag !== "--policy" ||
    !policyPath ||
    policyPath.startsWith("--")
  ) {
    return inputError(`Usage: ${RELEASE_VERSION_SYNOPSIS}`);
  }

  let input: unknown;
  let policy: unknown;
  let stage = "versions";
  try {
    input = JSON.parse(await readFile(inputPath, "utf-8"));
    stage = "policy";
    policy = JSON.parse(await readFile(policyPath, "utf-8"));
  } catch {
    return inputError(`Unable to read or parse ${stage} JSON`);
  }
  // The evaluator validates both decoded values and owns their diagnostic.
  return evaluateReleaseVersion(
    input as ReleaseVersionInput,
    policy as ReleaseVersionPolicy
  );
};
