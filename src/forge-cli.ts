import path from "node:path";

import { receiptExitCode, runCheck } from "./run-check.ts";

const args = Bun.argv.slice(2);
let config = "forge.json";
let base: string | null = null;
let valid = args.shift() === "check";
const seen = new Set<string>();
while (args.length > 0) {
  const flag = args.shift();
  const value = args.shift();
  if (!flag || !value || seen.has(flag)) {
    valid = false;
    break;
  }
  seen.add(flag);
  if (flag === "--config") {
    config = value;
  } else if (flag === "--base") {
    base = value;
  } else {
    valid = false;
  }
}
if (valid) {
  const receipt = await runCheck(process.cwd(), path.resolve(config), base);
  console.log(JSON.stringify(receipt));
  process.exitCode = receiptExitCode(receipt);
} else {
  console.log(
    JSON.stringify({
      diagnostic: "Usage: forge check [--config <file>] [--base <commit-oid>]",
      kind: "forge-check-input-error",
      schemaVersion: 1,
    })
  );
  process.exitCode = 2;
}
