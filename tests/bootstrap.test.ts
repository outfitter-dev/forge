import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  realpathSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
const source = path.resolve(import.meta.dir, "..");

const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "forge bootstrap "));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "bin"));
  cpSync(
    path.join(source, "scripts/bootstrap.sh"),
    path.join(root, "scripts/bootstrap.sh")
  );
  cpSync(
    path.join(source, ".bb-env-setup.sh"),
    path.join(root, ".bb-env-setup.sh")
  );
  writeFileSync(path.join(root, ".bun-version"), "1.4.4\n");
  writeFileSync(
    path.join(root, "bin/bun"),
    `#!/bin/bash
if [[ "$1" == --version ]]; then
  echo "\${TEST_BUN_VERSION:-1.4.4}"
else
  printf '%s\\n' "$PWD" "$*" >> "$TEST_LOG"
  exit "\${TEST_INSTALL_EXIT:-0}"
fi
`
  );
  chmodSync(path.join(root, "bin/bun"), 0o755);
  return root;
};

const run = (
  root: string,
  env: Record<string, string> = {},
  hook = "scripts/bootstrap.sh",
  args: string[] = []
) =>
  Bun.spawnSync(["/bin/bash", path.join(root, hook), ...args], {
    cwd: tmpdir(),
    env: {
      PATH: `${root}/bin:/usr/bin:/bin`,
      TEST_LOG: path.join(root, "calls"),
      ...env,
    },
  });

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("BB setup installs in its own checkout with a frozen lockfile and can repeat", () => {
  const root = fixture();
  expect(run(root, {}, ".bb-env-setup.sh").exitCode).toBe(0);
  expect(run(root).exitCode).toBe(0);
  const lines = readFileSync(path.join(root, "calls"), "utf-8")
    .trim()
    .split("\n");
  expect(lines[1]).toBe("install --frozen-lockfile");
  expect(lines[3]).toBe("install --frozen-lockfile");
  // macOS resolves /var to /private/var when the shell changes directories.
  expect(realpathSync(lines[0] ?? "")).toBe(realpathSync(root));
  expect(lines[2]).toBe(lines[0]);
});

test("wrong runtime and invalid pins stop before install", () => {
  const root = fixture();
  expect(run(root, { TEST_BUN_VERSION: "1.4.5" }).exitCode).toBe(1);
  writeFileSync(path.join(root, ".bun-version"), "bad-pin\n");
  expect(run(root).exitCode).toBe(1);
  expect(existsSync(path.join(root, "calls"))).toBe(false);
});

test("install failures propagate through the BB hook", () => {
  expect(
    run(fixture(), { TEST_INSTALL_EXIT: "42" }, ".bb-env-setup.sh").exitCode
  ).toBe(42);
});

test("shared dependency symlinks are rejected", () => {
  const root = fixture();
  symlinkSync(path.join(root, "bin"), path.join(root, "node_modules"));
  expect(run(root).exitCode).toBe(1);
});

test("unknown arguments fail instead of silently skipping requested behavior", () => {
  expect(
    run(fixture(), {}, "scripts/bootstrap.sh", ["--update"]).exitCode
  ).toBe(2);
});
