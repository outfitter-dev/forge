import { readFile } from "node:fs/promises";
import path from "node:path";

import { captureBuildkiteProjectCheck } from "./buildkite-project-capture.ts";
import type { BuildkiteProjectLaunch } from "./buildkite-project-capture.ts";
import { isRecord } from "./github-response.ts";

const run = async () => {
  const [file, ...extra] = Bun.argv.slice(2);
  if (!file || !path.isAbsolute(file) || extra.length > 0) {
    return 2;
  }
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf-8"));
    const fields = [
      "jobId",
      "repository",
      "head",
      "base",
      "projectRoot",
      "captureRoot",
      "launcher",
      "runner",
      "toolBin",
    ] as const;
    if (
      !isRecord(value) ||
      !fields.every((key) => typeof value[key] === "string") ||
      typeof value.timeoutMs !== "number"
    ) {
      return 2;
    }
    const result = await captureBuildkiteProjectCheck(
      value as unknown as BuildkiteProjectLaunch
    );
    console.log(JSON.stringify(result));
    return result.status === "captured" ? result.capture.runnerExitCode : 1;
  } catch {
    console.error("Forge could not capture the project check.");
    return 2;
  }
};

process.exitCode = await run();
