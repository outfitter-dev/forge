import { lstat } from "node:fs/promises";
import path from "node:path";

import { receiptExitCode, runCheck } from "./run-check.ts";

const oid = (value: string | undefined): value is string =>
  value !== undefined && /^[a-f0-9]{40}$/u.test(value);

const check = async (args: string[]): Promise<number> => {
  const [repository, head, base, bin] = args;
  if (
    args.length !== 4 ||
    !repository ||
    !/^[\w.-]+\/[\w.-]+$/u.test(repository) ||
    !oid(head) ||
    !oid(base) ||
    !bin ||
    !path.isAbsolute(bin) ||
    /[:\s]/u.test(bin)
  ) {
    console.error(
      "Usage: forge-buildkite-project-check <repository> <head> <base> <tool-bin>"
    );
    return 2;
  }
  const root = process.cwd();
  const gitDir = await lstat(path.join(root, ".git")).catch(() => null);
  if (!gitDir?.isDirectory() || !process.getuid?.()) {
    console.error(
      "Forge project check needs an unprivileged user and a standalone checkout."
    );
    return 2;
  }
  if (Object.keys(process.env).length !== 0) {
    console.error("Forge project check must start with an empty environment.");
    return 2;
  }
  const receipt = await runCheck(root, path.join(root, "forge.json"), base, {
    head,
    repository,
    toolPath: `${bin}:/usr/bin:/bin`,
  });
  console.log(JSON.stringify(receipt));
  return receiptExitCode(receipt);
};

process.exitCode = await check(Bun.argv.slice(2));
