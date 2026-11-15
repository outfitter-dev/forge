import { afterAll, afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.resolve(
  import.meta.dir,
  "../scripts/verify-trusted-install.sh"
);
const repository = "acme/forge";
const origin = `https://github.com/${repository}.git`;
const source = "src/forge-cli.ts";
const original = "export const answer = 1;\n";
const sameSize = "export const answer = 2;\n";
const usage =
  "Usage: scripts/verify-trusted-install.sh --install <absolute-dir> --repository <owner/name> --commit <40-hex>";

const failures = {
  bunMissing: "bun is not on PATH.",
  bunVersion:
    "the Bun on PATH is not the version the install's .bun-version pins.",
  flags:
    "the install's index has entries flagged assume-unchanged or skip-worktree.",
  head: "the install's HEAD is not the expected commit.",
  path: "the install path is not an existing directory, or it is a symlink.",
  pin: "the install has no .bun-version holding a three-part version.",
  remote:
    "the install's origin remote is not the expected GitHub repository over HTTPS.",
  submodules: "the install has submodules.",
  tree: "the install's working tree is not exactly the expected commit.",
  workTree:
    "the install path is not the top level of a Git work tree owned by the user running this check.",
} as const;
type Failure = keyof typeof failures;

// Fixture Git calls see no developer, system or XDG configuration.
const home = mkdtempSync(path.join(tmpdir(), "forge trusted install home "));
const git = (cwd: string, ...args: string[]) => {
  const child = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: home,
      PATH: "/usr/bin:/bin",
    },
  });
  if (child.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${child.stderr.toString()}`);
  }
  return child.stdout.toString().trim();
};

/** One two-commit repository, built once and copied for each test. */
const template = (() => {
  const install = path.join(home, "template");
  mkdirSync(path.join(install, "src"), { recursive: true });
  git(install, "init", "-q", "-b", "main");
  writeFileSync(path.join(install, ".bun-version"), "1.4.4\n");
  writeFileSync(path.join(install, ".gitignore"), "node_modules/\n");
  writeFileSync(path.join(install, source), "export const answer = 0;\n");
  symlinkSync(source, path.join(install, "latest"));
  git(install, "add", "-A");
  git(install, "commit", "-q", "-m", "one");
  const parent = git(install, "rev-parse", "HEAD");
  writeFileSync(path.join(install, source), original);
  git(install, "commit", "-q", "-a", "-m", "two");
  git(install, "remote", "add", "origin", origin);
  return { commit: git(install, "rev-parse", "HEAD"), install, parent };
})();

interface Fixture {
  bin: string;
  install: string;
  root: string;
}
interface Overrides {
  commit?: string;
  env?: Record<string, string>;
  install?: string;
}

const roots: string[] = [];
const fixture = (): Fixture => {
  const root = mkdtempSync(path.join(tmpdir(), "forge trusted install "));
  roots.push(root);
  const install = path.join(root, "install");
  cpSync(template.install, install, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "bun"),
    `#!/bin/bash
[[ "$1" == --version ]] || exit 64
echo "\${TEST_BUN_VERSION:-1.4.4}"
exit "\${TEST_BUN_EXIT:-0}"
`
  );
  chmodSync(path.join(bin, "bun"), 0o755);
  return { bin, install, root };
};

const run = (args: string[], env: Record<string, string>) => {
  const child = Bun.spawnSync(["/bin/bash", script, ...args], {
    cwd: tmpdir(),
    env,
  });
  return {
    exitCode: child.exitCode,
    stderr: child.stderr.toString(),
    stdout: child.stdout.toString(),
  };
};

const verify = (fx: Fixture, overrides: Overrides = {}) =>
  run(
    [
      "--install",
      overrides.install ?? fx.install,
      "--repository",
      repository,
      "--commit",
      overrides.commit ?? template.commit,
    ],
    { PATH: `${fx.bin}:/usr/bin:/bin`, ...overrides.env }
  );

const verified = {
  exitCode: 0,
  stderr: "",
  stdout: `trusted install verified: ${repository} ${template.commit} bun 1.4.4\n`,
};
const failed = (failure: Failure) => ({
  exitCode: 1,
  stderr: `Error: ${failures[failure]}\n`,
  stdout: "",
});

const write = (fx: Fixture, file: string, contents: string) => {
  writeFileSync(path.join(fx.install, file), contents);
};
const commitAll = (fx: Fixture) => {
  git(fx.install, "add", "-A");
  git(fx.install, "commit", "-q", "-m", "fixture");
  return git(fx.install, "rev-parse", "HEAD");
};
/** A caller's home whose Git configuration would change the answer if it were read. */
const callerHome = (fx: Fixture, config: string) => {
  const directory = path.join(fx.root, "caller home");
  mkdirSync(path.join(directory, "xdg/git"), { recursive: true });
  writeFileSync(path.join(directory, "ignore"), "notes.txt\n");
  writeFileSync(path.join(directory, "xdg/git/ignore"), "notes.txt\n");
  writeFileSync(path.join(directory, ".gitconfig"), config);
  return {
    GIT_CONFIG_GLOBAL: path.join(directory, ".gitconfig"),
    HOME: directory,
    XDG_CONFIG_HOME: path.join(directory, "xdg"),
  };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});
afterAll(() => {
  rmSync(home, { force: true, recursive: true });
});

test("a clean install at the pinned commit with the pinned Bun verifies", () => {
  expect(verify(fixture())).toEqual(verified);
});

test("the origin URL may omit the .git suffix", () => {
  const fx = fixture();
  git(fx.install, "remote", "set-url", "origin", origin.slice(0, -4));
  expect(verify(fx)).toEqual(verified);
});

test("the install's own status.showUntrackedFiles setting does not fail a clean install", () => {
  const fx = fixture();
  git(fx.install, "config", "status.showUntrackedFiles", "no");
  expect(verify(fx)).toEqual(verified);
});

test("a doubled slash inside the install path is not a usage error", () => {
  const fx = fixture();
  const install = fx.install.replace("/install", "//install");
  expect(verify(fx, { install })).toEqual(verified);
});

const pinned = "0123456789abcdef0123456789abcdef01234567";
const flags = (overrides: Record<string, string> = {}) =>
  Object.entries({
    "--commit": pinned,
    "--install": "/opt/forge",
    "--repository": repository,
    ...overrides,
  }).flat();
const without = (flag: string) => flags().toSpliced(flags().indexOf(flag), 2);
const required = "--install, --repository and --commit are all required.";
const badInstall =
  "--install must be an absolute path with no trailing slash and no . or .. component.";
const badCommit = "--commit must be 40 lowercase hexadecimal characters.";
const badRepository =
  "--repository must be owner/name in letters, digits, hyphens, underscores and dots.";
const usageErrors: [string, string[], string][] = [
  ["no arguments", [], required],
  ["a missing --install", without("--install"), required],
  ["a missing --repository", without("--repository"), required],
  ["a missing --commit", without("--commit"), required],
  [
    "a repeated --install",
    [...flags(), "--install", "/opt/other"],
    "--install was given more than once.",
  ],
  [
    "a repeated --repository",
    [...flags(), "--repository", repository],
    "--repository was given more than once.",
  ],
  [
    "a repeated --commit",
    [...flags(), "--commit", pinned],
    "--commit was given more than once.",
  ],
  ["an unknown flag", [...flags(), "--force", "yes"], "unknown argument."],
  ["a positional argument", ["/opt/forge", ...flags()], "unknown argument."],
  [
    "a flag joined to its value",
    ["--install=/opt/forge", ...without("--install")],
    "unknown argument.",
  ],
  [
    "a flag with no value",
    [...without("--install"), "--install"],
    "--install needs a value.",
  ],
  [
    "a value that starts with --",
    flags({ "--repository": "--commit" }),
    "--repository needs a value.",
  ],
  ["a relative install path", flags({ "--install": "opt/forge" }), badInstall],
  ["an empty install path", flags({ "--install": "" }), badInstall],
  [
    "an install path with a trailing slash",
    flags({ "--install": "/opt/forge/" }),
    badInstall,
  ],
  [
    "an install path with a .. component",
    flags({ "--install": "/opt/forge/../other" }),
    badInstall,
  ],
  [
    "an install path with a . component",
    flags({ "--install": "/opt/forge/." }),
    badInstall,
  ],
  [
    "an uppercase commit",
    flags({ "--commit": pinned.toUpperCase() }),
    badCommit,
  ],
  ["a short commit", flags({ "--commit": pinned.slice(1) }), badCommit],
  ["a long commit", flags({ "--commit": `${pinned}0` }), badCommit],
  [
    "a commit followed by a newline",
    flags({ "--commit": `${pinned}\n` }),
    badCommit,
  ],
  [
    "a repository without an owner",
    flags({ "--repository": "forge" }),
    badRepository,
  ],
  [
    "a repository with three parts",
    flags({ "--repository": "acme/forge/extra" }),
    badRepository,
  ],
  [
    "a repository with a character GitHub does not allow",
    flags({ "--repository": "acme/for ge" }),
    badRepository,
  ],
  [
    "a repository with a .. part",
    flags({ "--repository": "acme/.." }),
    badRepository,
  ],
];

test.each(usageErrors)("%s is a usage error", (_title, args, reason) => {
  expect(run(args, { PATH: "/usr/bin:/bin" })).toEqual({
    exitCode: 2,
    stderr: `Error: ${reason}\n${usage}\n`,
    stdout: "",
  });
});

const secret = "s3cr3t-t0ken";
const other = "https://github.com/acme/other.git";
const failingInstalls: [string, Failure, (fx: Fixture) => Overrides][] = [
  // 1. The install path.
  [
    "a missing install path",
    "path",
    (fx) => ({ install: path.join(fx.root, "absent") }),
  ],
  [
    "an install path that is a file",
    "path",
    (fx) => ({ install: path.join(fx.bin, "bun") }),
  ],
  [
    "a symlinked install path",
    "path",
    (fx) => {
      symlinkSync(fx.install, path.join(fx.root, "link"));
      return { install: path.join(fx.root, "link") };
    },
  ],
  // 2. The top level of a work tree.
  [
    "a subdirectory of a work tree",
    "workTree",
    (fx) => ({ install: path.join(fx.install, "src") }),
  ],
  [
    "a bare repository",
    "workTree",
    (fx) => {
      git(fx.root, "clone", "-q", "--bare", fx.install, "bare.git");
      return { install: path.join(fx.root, "bare.git") };
    },
  ],
  [
    "a directory that is not a repository",
    "workTree",
    (fx) => ({ install: fx.bin }),
  ],
  [
    "a repository whose work tree is configured elsewhere",
    "workTree",
    (fx) => {
      git(fx.install, "config", "core.worktree", fx.bin);
      return {};
    },
  ],
  // 3. HEAD.
  ["a commit the install does not have", "head", () => ({ commit: pinned })],
  [
    "a HEAD one commit ahead of the pin",
    "head",
    () => ({ commit: template.parent }),
  ],
  // 4. The origin remote.
  [
    "an origin for another repository",
    "remote",
    (fx) => {
      git(fx.install, "remote", "set-url", "origin", other);
      return {};
    },
  ],
  [
    "an SSH origin",
    "remote",
    (fx) => {
      const url = `git@github.com:${repository}.git`;
      git(fx.install, "remote", "set-url", "origin", url);
      return {};
    },
  ],
  [
    "an origin with embedded credentials",
    "remote",
    (fx) => {
      const url = origin.replace("//", `//forge-bot:${secret}@`);
      git(fx.install, "remote", "set-url", "origin", url);
      return {};
    },
  ],
  [
    "a missing origin",
    "remote",
    (fx) => {
      git(fx.install, "remote", "remove", "origin");
      return {};
    },
  ],
  [
    "an origin with a second URL",
    "remote",
    (fx) => {
      git(fx.install, "remote", "set-url", "--add", "origin", `${origin}/`);
      return {};
    },
  ],
  [
    "an origin the install's configuration rewrites elsewhere",
    "remote",
    (fx) => {
      const key = "url.https://example.invalid/.insteadOf";
      git(fx.install, "config", key, "https://github.com/");
      return {};
    },
  ],
  [
    "an origin a job's GIT_CONFIG_COUNT would rewrite to the expected one",
    "remote",
    (fx) => {
      git(fx.install, "remote", "set-url", "origin", other);
      return {
        env: {
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: `url.${origin}.insteadOf`,
          GIT_CONFIG_VALUE_0: other,
        },
      };
    },
  ],
  // 5. The working tree.
  [
    "a modified tracked file",
    "tree",
    (fx) => {
      write(fx, source, "export const answer = 42;\n");
      return {};
    },
  ],
  [
    "a staged change whose file was put back",
    "tree",
    (fx) => {
      write(fx, source, sameSize);
      git(fx.install, "add", source);
      write(fx, source, original);
      return {};
    },
  ],
  [
    "a deleted tracked file",
    "tree",
    (fx) => {
      rmSync(path.join(fx.install, source));
      return {};
    },
  ],
  [
    "an untracked file",
    "tree",
    (fx) => {
      write(fx, "notes.txt", "left behind\n");
      return {};
    },
  ],
  [
    "an untracked file the install's configuration hides",
    "tree",
    (fx) => {
      write(fx, "notes.txt", "left behind\n");
      git(fx.install, "config", "status.showUntrackedFiles", "no");
      return {};
    },
  ],
  [
    "an untracked file the caller's global excludes ignore",
    "tree",
    (fx) => {
      write(fx, "notes.txt", "left behind\n");
      const ignore = path.join(fx.root, "caller home/ignore");
      const config = `[core]\n\texcludesFile = ${ignore}\n[status]\n\tshowUntrackedFiles = no\n`;
      return { env: callerHome(fx, config) };
    },
  ],
  [
    "an ignored file",
    "tree",
    (fx) => {
      mkdirSync(path.join(fx.install, "node_modules"));
      write(fx, "node_modules/left.js", "export {};\n");
      return {};
    },
  ],
  [
    "an executable bit the install's configuration ignores",
    "tree",
    (fx) => {
      chmodSync(path.join(fx.install, source), 0o755);
      git(fx.install, "config", "core.fileMode", "false");
      expect(git(fx.install, "status", "--porcelain")).toBe("");
      return {};
    },
  ],
  [
    "an assume-unchanged file whose bytes differ",
    "tree",
    (fx) => {
      git(fx.install, "update-index", "--assume-unchanged", source);
      write(fx, source, sameSize);
      expect(git(fx.install, "status", "--porcelain")).toBe("");
      return {};
    },
  ],
  [
    "a same-size edit a configured clean filter hides from Git's status",
    "tree",
    (fx) => {
      const attributes = path.join(fx.install, ".git/info/attributes");
      writeFileSync(attributes, `${source} filter=pinned\n`);
      const clean = `cat >/dev/null; printf '${original.trim()}\\n'`;
      git(fx.install, "config", "filter.pinned.clean", clean);
      write(fx, source, sameSize);
      expect(git(fx.install, "status", "--porcelain")).toBe("");
      return {};
    },
  ],
  [
    "a retargeted symlink that relaxed stat settings hide from Git's status",
    "tree",
    (fx) => {
      const link = path.join(fx.install, "latest");
      const past = new Date("2020-01-01T00:00:00Z");
      const later = new Date("2037-01-01T00:00:00Z");
      git(fx.install, "config", "core.checkStat", "minimal");
      git(fx.install, "config", "core.trustctime", "false");
      lutimesSync(link, past, past);
      git(fx.install, "update-index", "--refresh");
      // An index newer than its entries is not re-read as racily clean.
      utimesSync(path.join(fx.install, ".git/index"), later, later);
      rmSync(link);
      symlinkSync(source.replace(".ts", ".js"), link);
      lutimesSync(link, past, past);
      expect(git(fx.install, "status", "--porcelain")).toBe("");
      return {};
    },
  ],
  [
    "a replace ref that swaps the pinned commit for another",
    "tree",
    (fx) => {
      git(fx.install, "replace", template.commit, template.parent);
      git(fx.install, "reset", "-q", "--hard");
      expect(git(fx.install, "rev-parse", "HEAD")).toBe(template.commit);
      expect(git(fx.install, "status", "--porcelain")).toBe("");
      return {};
    },
  ],
  [
    "a modified install when GIT_DIR and GIT_WORK_TREE name a clean copy",
    "tree",
    (fx) => {
      const clean = path.join(fx.root, "clean");
      cpSync(fx.install, clean, { recursive: true, verbatimSymlinks: true });
      write(fx, source, sameSize);
      const env = { GIT_DIR: path.join(clean, ".git"), GIT_WORK_TREE: clean };
      return { env };
    },
  ],
  // 6. Index flags and submodules.
  [
    "an assume-unchanged file",
    "flags",
    (fx) => {
      git(fx.install, "update-index", "--assume-unchanged", source);
      return {};
    },
  ],
  [
    "a skip-worktree file",
    "flags",
    (fx) => {
      git(fx.install, "update-index", "--skip-worktree", source);
      return {};
    },
  ],
  [
    "a submodule",
    "submodules",
    (fx) => {
      const entry = `160000,${template.parent},vendor/sub`;
      git(fx.install, "update-index", "--add", "--cacheinfo", entry);
      mkdirSync(path.join(fx.install, "vendor/sub"), { recursive: true });
      git(fx.install, "commit", "-q", "-m", "submodule");
      return { commit: git(fx.install, "rev-parse", "HEAD") };
    },
  ],
  // 7. The Bun pin.
  [
    "a missing .bun-version",
    "pin",
    (fx) => {
      rmSync(path.join(fx.install, ".bun-version"));
      return { commit: commitAll(fx) };
    },
  ],
  [
    "a .bun-version that is not a three-part version",
    "pin",
    (fx) => {
      write(fx, ".bun-version", "1.4\n");
      return { commit: commitAll(fx) };
    },
  ],
  [
    "a different Bun version",
    "bunVersion",
    () => ({ env: { TEST_BUN_VERSION: "1.4.5" } }),
  ],
  [
    "a Bun that prints the pin and fails",
    "bunVersion",
    () => ({ env: { TEST_BUN_EXIT: "1" } }),
  ],
  ["no bun on PATH", "bunMissing", () => ({ env: { PATH: "/usr/bin:/bin" } })],
];

test.each(failingInstalls)("%s fails its check", (_title, failure, arrange) => {
  const fx = fixture();
  const result = verify(fx, arrange(fx));
  expect(result).toEqual(failed(failure));
  expect(result.stderr + result.stdout).not.toContain(secret);
});

test("a configured fsmonitor program is not run", () => {
  const fx = fixture();
  const marker = path.join(fx.root, "fsmonitor ran");
  const hook = path.join(fx.bin, "fsmonitor");
  writeFileSync(hook, `#!/bin/bash\n: > "${marker}"\n`);
  chmodSync(hook, 0o755);
  // Git runs the value through a shell, and the path holds spaces.
  git(fx.install, "config", "core.fsmonitor", `'${hook}'`);
  expect(verify(fx)).toEqual(verified);
  expect(existsSync(marker)).toBe(false);
  git(fx.install, "status", "--porcelain");
  expect(existsSync(marker)).toBe(true);
});

test("verification leaves the install's index untouched", () => {
  const fx = fixture();
  const index = path.join(fx.install, ".git/index");
  const before = readFileSync(index);
  expect(verify(fx)).toEqual(verified);
  expect(readFileSync(index).equals(before)).toBe(true);
  // The copied files have new stat data, which Git's own status would record.
  git(fx.install, "status", "--porcelain");
  expect(readFileSync(index).equals(before)).toBe(false);
});

const hostile: [string, (fx: Fixture) => Record<string, string>][] = [
  ["GIT_DIR", (fx) => ({ GIT_DIR: path.join(fx.root, "absent/.git") })],
  ["GIT_WORK_TREE", (fx) => ({ GIT_WORK_TREE: fx.bin })],
  ["GIT_INDEX_FILE", (fx) => ({ GIT_INDEX_FILE: path.join(fx.bin, "bun") })],
  ["GIT_OBJECT_DIRECTORY", (fx) => ({ GIT_OBJECT_DIRECTORY: fx.bin })],
  [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES, GIT_NAMESPACE and GIT_CEILING_DIRECTORIES",
    (fx) => ({
      GIT_ALTERNATE_OBJECT_DIRECTORIES: fx.bin,
      GIT_CEILING_DIRECTORIES: fx.install,
      GIT_NAMESPACE: "elsewhere",
    }),
  ],
  [
    "GIT_CONFIG_COUNT",
    () => ({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "remote.origin.url",
      GIT_CONFIG_VALUE_0: "https://example.invalid/other.git",
    }),
  ],
  [
    "HOME, XDG_CONFIG_HOME and GIT_CONFIG_GLOBAL",
    (fx) =>
      callerHome(
        fx,
        `[core]\n\texcludesFile = ${path.join(fx.root, "caller home/ignore")}\n[url "https://example.invalid/"]\n\tinsteadOf = https://github.com/\n`
      ),
  ],
];

test.each(hostile)(
  "a clean install still verifies under a hostile %s",
  (_name, env) => {
    const fx = fixture();
    expect(verify(fx, { env: env(fx) })).toEqual(verified);
  }
);
