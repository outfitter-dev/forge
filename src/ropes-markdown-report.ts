import path from "node:path";

import { exitCodeOf, parseResult } from "@ropes/core";
import { renderHuman } from "@ropes/core/render";

export const markdownReport = (stdout: string, exitCode: number): string => {
  let input: unknown;
  try {
    input = JSON.parse(stdout);
  } catch {
    throw new Error("Ropes returned malformed JSON.");
  }

  const parsed = parseResult(input);
  if (!parsed.ok) {
    throw new Error(
      parsed.error.kind === "unknown-version"
        ? "Ropes returned an unsupported result schema version."
        : "Ropes returned an invalid check result."
    );
  }
  if (exitCodeOf(parsed.value) !== exitCode) {
    throw new Error("Ropes exit code disagrees with the check result.");
  }
  return renderHuman(parsed.value);
};

if (import.meta.main) {
  try {
    const child = Bun.spawnSync(
      [process.execPath, "run", "ropes:markdown", "--json"],
      {
        cwd: path.join(import.meta.dir, ".."),
        stderr: "inherit",
        stdout: "pipe",
      }
    );
    console.log(markdownReport(child.stdout.toString(), child.exitCode));
    process.exitCode = child.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
