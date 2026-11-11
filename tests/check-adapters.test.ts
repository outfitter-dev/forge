import { afterEach, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { cli, fixture, gitFixture } from "./check-fixtures.ts";

const roots: string[] = [];
const source = path.resolve(import.meta.dir, "..");
const manifest = JSON.parse(
  readFileSync(path.join(source, "package.json"), "utf-8")
) as { scripts: Record<string, string>; trustedDependencies: string[] };
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("real lefthook adapter runs the declared command once without installing hooks", () => {
  const root = fixture(
    'const fs=require("fs"); const f=".git/invocations"; fs.appendFileSync(f,"ran\\n")'
  );
  roots.push(root);
  copyFileSync(
    path.join(source, "lefthook.yml"),
    path.join(root, "lefthook.yml")
  );
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { forge: `bun ${cli}` } })
  );
  const result = Bun.spawnSync(
    [
      path.join(source, "node_modules/.bin/lefthook"),
      "run",
      "pre-push",
      "--no-auto-install",
      "--force",
    ],
    { cwd: root, env: { PATH: process.env.PATH } }
  );
  expect(result.exitCode).toBe(0);
  expect(readFileSync(path.join(root, ".git/invocations"), "utf-8")).toBe(
    "ran\n"
  );
  expect(existsSync(path.join(root, ".git/hooks/pre-push"))).toBe(false);
  expect(manifest.scripts["check:hook"]).toBe(
    "lefthook run pre-push --no-auto-install --force"
  );
});

test("package and CI invoke the same CLI while retaining evaluator qualification", () => {
  expect(manifest.scripts.forge).toBe("bun src/forge-cli.ts");
  const workflow = readFileSync(
    path.join(source, ".github/workflows/ci.yml"),
    "utf-8"
  );
  expect(workflow).toContain("- run: bun run forge check");
  expect(workflow).toContain("run: bun test tests/cli.test.ts");
  const root = fixture();
  roots.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { forge: `bun ${cli}` } })
  );
  const child = Bun.spawnSync([process.execPath, "run", "forge", "check"], {
    cwd: root,
    env: { PATH: process.env.PATH },
  });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toMatchObject({
    kind: "forge-check",
    outcome: "passed",
  });
});

test("explicit empty dependency trust blocks hook-install lifecycle in offline local packages", () => {
  expect(manifest.trustedDependencies).toEqual([]);
  for (const trust of [[], ["lefthook"]]) {
    const root = fixture();
    roots.push(root);
    const dependency = path.join(root, "dependency");
    mkdirSync(dependency);
    writeFileSync(
      path.join(dependency, "package.json"),
      JSON.stringify({
        name: "lefthook",
        scripts: { postinstall: "bun install-hook.js" },
        version: "2.2.2",
      })
    );
    writeFileSync(
      path.join(dependency, "install-hook.js"),
      'require("fs").writeFileSync(process.env.INIT_CWD+"/.git/hooks/pre-push", "fixture-hook")'
    );
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        dependencies: { lefthook: "file:./dependency" },
        trustedDependencies: trust,
      })
    );
    const result = Bun.spawnSync([process.execPath, "install"], {
      cwd: root,
      env: { PATH: process.env.PATH },
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(root, ".git/hooks/pre-push"))).toBe(
      trust.length > 0
    );
    // No fixture hook is executable; no subsequent Git operation runs it.
    expect(gitFixture(root, "rev-parse", "--is-inside-work-tree")).toBe("true");
  }
});

test.each([
  [],
  ["wrong"],
  ["check", "--config"],
  ["check", "--other", "x"],
  ["check", "--base", "a", "--base", "b"],
])(
  "invalid arguments produce a distinct input-error frame: %p",
  (...args: string[]) => {
    const child = Bun.spawnSync([process.execPath, cli, ...args], { env: {} });
    expect(child.exitCode).toBe(2);
    expect(JSON.parse(child.stdout.toString())).toMatchObject({
      kind: "forge-check-input-error",
      schemaVersion: 1,
    });
  }
);
