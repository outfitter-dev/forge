import { readFile } from "node:fs/promises";
import path from "node:path";

import { collectBuildkiteGateReceipt } from "./collect-buildkite-gate-receipt.ts";
import type { GateReceiptCollectionInput } from "./collect-buildkite-gate-receipt.ts";
import { isRecord } from "./github-response.ts";

const run = async () => {
  const [file, ...extra] = Bun.argv.slice(2);
  if (!file || !path.isAbsolute(file) || extra.length > 0) {
    return 2;
  }
  const readToken = process.env.FORGE_BUILDKITE_READ_TOKEN;
  if (
    !readToken ||
    Object.keys(process.env).includes("BUN_CONFIG_VERBOSE_FETCH")
  ) {
    return 2;
  }
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf-8"));
    if (
      !isRecord(value) ||
      !isRecord(value.admission) ||
      !(value.expectation === null || isRecord(value.expectation)) ||
      !Array.isArray(value.artifactOrigins) ||
      !value.artifactOrigins.every((origin) => typeof origin === "string") ||
      ![
        "captureRoot",
        "outputRoot",
        "organizationSlug",
        "pipelineSlug",
        "artifactPath",
      ].every((key) => typeof value[key] === "string") ||
      typeof value.buildNumber !== "number"
    ) {
      return 2;
    }
    const result = await collectBuildkiteGateReceipt({
      ...(value as unknown as GateReceiptCollectionInput),
      readToken,
      request: fetch,
    });
    console.log(JSON.stringify(result));
    return result.status === "ready" ? 0 : 1;
  } catch {
    console.error("Forge could not collect the project receipt.");
    return 2;
  }
};

process.exitCode = await run();
