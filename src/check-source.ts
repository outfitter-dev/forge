import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

import { digest } from "./check-config.ts";
import type { CheckSource } from "./check-types.ts";

export const git = (
  root: string,
  args: string[],
  toolPath?: string
): string => {
  const controlled =
    toolPath === undefined
      ? []
      : ["--no-replace-objects", "-c", "core.fsmonitor=false"];
  const result = Bun.spawnSync(
    ["git", "--no-optional-locks", ...controlled, ...args],
    {
      cwd: root,
      env: {
        ...(toolPath === undefined ? {} : { GIT_CONFIG_GLOBAL: "/dev/null" }),
        GIT_CONFIG_NOSYSTEM: "1",
        PATH: toolPath ?? process.env.PATH,
      },
      stderr: "pipe",
    }
  );
  if (result.exitCode !== 0) {
    throw new Error("Source observation unavailable");
  }
  return result.stdout.toString();
};

/** Hash bytes and mode of current files, including staged/deleted/untracked changes. */
export const observeSource = (
  root: string,
  base: string | null,
  toolPath?: string
): CheckSource => {
  const query = (args: string[]) => git(root, args, toolPath);
  const head = query(["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const tree = query(["rev-parse", "HEAD^{tree}"]).trim();
  const index = query(["ls-files", "--stage", "-z"]);
  // Submodule contents are outside this initial coverage contract.
  if (index.split("\0").some((entry) => entry.startsWith("160000 "))) {
    throw new Error("Submodule coverage unavailable");
  }
  // Git status can hide working-tree changes for these index flags.
  const taggedFiles = query(["ls-files", "-v", "-z"]);
  if (taggedFiles.split("\0").some((entry) => /^[a-zS] /u.test(entry))) {
    throw new Error("Flagged index coverage unavailable");
  }
  const tracked = query(["ls-files", "-z"]).split("\0").filter(Boolean);
  const untracked = query(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
  const hash = createHash("sha256");
  for (const name of [...new Set([...tracked, ...untracked])].toSorted()) {
    const file = path.join(root, name);
    hash.update(JSON.stringify(name));
    try {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        hash.update(JSON.stringify(["symlink", readlinkSync(file)]));
      } else if (stat.isFile()) {
        hash.update(JSON.stringify(["file", stat.mode.toString(8)]));
        hash.update(digest(readFileSync(file)));
      } else {
        throw new Error("Unsupported source entry");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      hash.update("missing");
    }
  }
  return {
    base,
    coverage: "tracked-and-nonignored-untracked",
    dirty:
      query(["status", "--porcelain=v1", "--untracked-files=normal"]).length >
      0,
    head,
    indexDigest: digest(index),
    mergeBase: base === null ? null : query(["merge-base", head, base]).trim(),
    tree,
    untracked: untracked.length,
    worktreeDigest: hash.digest("hex"),
  };
};
