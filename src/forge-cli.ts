import path from "node:path";

import { GATE_SYNOPSIS } from "./gate-arguments.ts";
import { gateExitCode } from "./gate-document.ts";
import { receiptExitCode, runCheck } from "./run-check.ts";
import { runGate } from "./run-gate.ts";

const CHECK_USAGE =
  "Usage: forge check [--config <file>] [--base <commit-oid>]";

const inputError = (diagnostic: string): void => {
  console.log(
    JSON.stringify({
      diagnostic,
      kind: "forge-check-input-error",
      schemaVersion: 1,
    })
  );
  process.exitCode = 2;
};

const check = async (args: string[]): Promise<void> => {
  let config = "forge.json";
  let base: string | null = null;
  const seen = new Set<string>();
  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (!flag || !value || seen.has(flag)) {
      inputError(CHECK_USAGE);
      return;
    }
    seen.add(flag);
    if (flag === "--config") {
      config = value;
    } else if (flag === "--base") {
      base = value;
    } else {
      inputError(CHECK_USAGE);
      return;
    }
  }
  const receipt = await runCheck(process.cwd(), path.resolve(config), base);
  console.log(JSON.stringify(receipt));
  process.exitCode = receiptExitCode(receipt);
};

const [command, ...args] = Bun.argv.slice(2);
if (command === "check") {
  await check(args);
} else if (command === "gate") {
  const document = await runGate({
    args,
    cwd: process.cwd(),
    env: process.env,
  });
  console.log(JSON.stringify(document));
  process.exitCode = gateExitCode(document);
} else {
  inputError(`${CHECK_USAGE} | ${GATE_SYNOPSIS}`);
}
