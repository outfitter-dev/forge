import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

import { digest } from "./check-config.ts";
import type { CheckSource } from "./check-types.ts";

export const git = (root: string, args: string[]): string => {
  const result = Bun.spawnSync(["git", "--no-optional-locks", ...args], {
    cwd: root,
    env: { GIT_CONFIG_NOSYSTEM: "1", PATH: process.env.PATH },
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error("Source observation unavailable");
  }
  return result.stdout.toString();
};

/** Hash bytes and mode of current files, including staged/deleted/untracked changes. */
export const observeSource = (
  root: string,
  base: string | null
): CheckSource => {
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const tree = git(root, ["rev-parse", "HEAD^{tree}"]).trim();
  const index = git(root, ["ls-files", "--stage", "-z"]);
  // Submodule contents are outside this initial coverage contract.
  if (index.split("\0").some((entry) => entry.startsWith("160000 "))) {
    throw new Error("Submodule coverage unavailable");
  }
  const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const untracked = git(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
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
      git(root, ["status", "--porcelain=v1", "--untracked-files=normal"])
        .length > 0,
    head,
    indexDigest: digest(index),
    mergeBase:
      base === null ? null : git(root, ["merge-base", head, base]).trim(),
    tree,
    untracked: untracked.length,
    worktreeDigest: hash.digest("hex"),
  };
};
