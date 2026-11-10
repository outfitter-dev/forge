import { readFile } from "node:fs/promises";

import { evaluateEvidence } from "./evaluate-evidence.ts";
import type { EvaluationResult } from "./evidence-types.ts";

const invalid = (path: string, message: string): EvaluationResult => ({
  eligible: false,
  issues: [{ message, path }],
  status: "invalid",
});

const evaluateFiles = async (args: string[]): Promise<EvaluationResult> => {
  const [factsPath, flag, policyPath] = args;
  if (args.length !== 3 || !factsPath || flag !== "--policy" || !policyPath) {
    return invalid(
      "arguments",
      "Usage: bun run evaluate <facts.json> --policy <policy.json>"
    );
  }
  let stage = "facts";
  try {
    const facts: unknown = JSON.parse(await readFile(factsPath, "utf-8"));
    stage = "policy";
    const policy: unknown = JSON.parse(await readFile(policyPath, "utf-8"));
    stage = "evaluation";
    return evaluateEvidence(facts, policy);
  } catch {
    // Parse errors can quote input contents. Keep diagnostics independent of
    // possibly sensitive JSON and leave the pure evaluator's errors here.
    return invalid(
      stage,
      stage === "evaluation"
        ? "Evidence evaluation failed"
        : `Unable to read or parse ${stage} JSON`
    );
  }
};

if (import.meta.main) {
  const result = await evaluateFiles(Bun.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "invalid") {
    console.error(
      result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")
    );
    process.exitCode = 2;
  } else {
    process.exitCode = result.eligible ? 0 : 1;
  }
}
