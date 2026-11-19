import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const linux = process.platform === "linux";
const root = path.join(import.meta.dir, "..");
const fixtureRoot = linux
  ? mkdtempSync(path.join(tmpdir(), "forge-hook-"))
  : "";
const staged = path.join(fixtureRoot, "staged");
const trusted = path.join(fixtureRoot, "trusted");
const checkout = path.join(fixtureRoot, "checkout");
const hook = path.join(fixtureRoot, "command");
const dispatcher = path.join(trusted, "dispatcher");
const source = path.join(root, "scripts/buildkite-bootstrap-hook.c");
const stageEnv = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
const stageArgs = [
  "/bin/bash",
  path.join(root, "scripts/stage-buildkite-bootstrap.sh"),
  staged,
];
const fixtureEnv = {
  BUILDKITE_AGENT_ACCESS_TOKEN: "fixture-job-token",
  BUILDKITE_JOB_ID: "11111111-2222-4333-8444-555555555555",
  FORGE_BUILDKITE_READ_TOKEN: "fixture-build-read",
  FORGE_GITHUB_TOKEN: "fixture-github-read",
};
const namespaceProbe =
  linux &&
  process.getuid?.() !== 0 &&
  Bun.spawnSync(
    [
      "/usr/bin/unshare",
      "--user",
      "--map-current-user",
      "--pid",
      "--fork",
      "/bin/true",
    ],
    { env: {} }
  ).exitCode === 0;

const launch = (env: Record<string, string | undefined>, args: string[] = []) =>
  Bun.spawn([hook, ...args], {
    cwd: checkout,
    env: { ...fixtureEnv, BUILDKITE_STEP_KEY: "forge-bootstrap", ...env },
    stderr: "pipe",
    stdin: new Blob(["discarded fixture input"]),
    stdout: "pipe",
  });

const writeDispatcher = (program: string) => {
  writeFileSync(dispatcher, `#!/usr/bin/python3\n${program}\n`, {
    mode: 0o700,
  });
};

const waitFor = async (file: string, attempts = 150): Promise<void> => {
  if (existsSync(path.join(trusted, file))) {
    return;
  }
  if (attempts === 0) {
    throw new Error(`Missing fixture marker: ${file}`);
  }
  await delay(20);
  await waitFor(file, attempts - 1);
};

beforeAll(() => {
  if (!linux) {
    return;
  }
  mkdirSync(trusted);
  mkdirSync(checkout);
  mkdirSync(staged);
  const compilation = Bun.spawnSync(
    [
      "/usr/bin/cc",
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-static",
      `-DFORGE_BOOTSTRAP_DIRECTORY=${JSON.stringify(trusted)}`,
      `-DFORGE_DISPATCHER=${JSON.stringify(dispatcher)}`,
      source,
      "-o",
      hook,
    ],
    { env: { PATH: "/usr/bin:/bin" } }
  );
  expect(compilation.stderr.toString()).toBe("");
  expect(compilation.exitCode).toBe(0);
  const bundle = Bun.spawnSync(stageArgs, { env: stageEnv });
  expect(bundle.stderr.toString()).toBe("");
  expect(bundle.exitCode).toBe(0);
}, 20_000);

afterAll(() => {
  if (linux) {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test.skipIf(!linux)(
  "stages a separate byte-for-byte verifier and native executables",
  () => {
    const copy = path.join(staged, "verify-trusted-install.sh");
    expect(readFileSync(copy)).toEqual(
      readFileSync(path.join(root, "scripts/verify-trusted-install.sh"))
    );
    expect(statSync(copy).mode % 0o1000).toBe(0o555);
    const elf = Bun.spawnSync(
      ["/usr/bin/readelf", "-l", path.join(staged, "command")],
      { env: stageEnv }
    );
    expect(elf.exitCode).toBe(0);
    expect(elf.stdout.toString()).not.toContain("INTERP");
    const dispatch = Bun.spawnSync(
      [path.join(staged, "forge-buildkite-dispatch")],
      { env: {} }
    );
    expect(dispatch.exitCode).not.toBe(0);
    expect(dispatch.stderr.toString()).toContain(
      "absolute host configuration path"
    );
    expect(Bun.spawnSync(stageArgs, { env: stageEnv }).exitCode).toBe(2);
  },
  20_000
);

test.skipIf(!linux)(
  "refuses commands, other steps, and missing or invalid protected inputs",
  async () => {
    const cases = [
      [{}, ["/fixture/config"], "only the trusted forge-bootstrap step"],
      [
        { BUILDKITE_STEP_KEY: "forge-gate" },
        [],
        "only the trusted forge-bootstrap step",
      ],
      [{ FORGE_GITHUB_TOKEN: "" }, [], "protected job inputs"],
      [
        { BUILDKITE_AGENT_ACCESS_TOKEN: "synthetic\ninvalid" },
        [],
        "protected job inputs",
      ],
    ] as const;
    await Promise.all(
      cases.map(async ([env, args, expected]) => {
        const child = launch(env, [...args]);
        expect(await child.exited).toBe(1);
        const stderr = await new Response(child.stderr).text();
        expect(stderr).toContain(expected);
        expect(stderr).not.toContain("synthetic");
      })
    );
  }
);

test.skipIf(!namespaceProbe)(
  "runs only the fixed dispatcher with a clean environment and propagates its failure",
  async () => {
    const unexpected = path.join(checkout, "startup-ran");
    const startup = path.join(checkout, "startup");
    writeFileSync(startup, `touch "${unexpected}"\n`);
    writeDispatcher(`import os, sys
assert sys.argv[1:] == [${JSON.stringify(path.join(trusted, "dispatch.json"))}]
assert os.getcwd() == ${JSON.stringify(trusted)}
initial_env = open("/proc/self/environ", "rb").read().decode().rstrip("\\0")
assert dict(item.split("=", 1) for item in initial_env.split("\\0")) == ${JSON.stringify({ ...fixtureEnv, HOME: trusted, PATH: "/usr/bin:/bin" })}
assert sys.stdin.read() == ""
sys.exit(23)`);
    const child = launch({
      BASH_ENV: startup,
      BUILDKITE_COMMAND: "ignored fixture command",
      BUN_CONFIG_VERBOSE_FETCH: "1",
      GIT_CONFIG_GLOBAL: "ignored",
      HOME: checkout,
      PATH: checkout,
    });
    expect(await child.exited).toBe(23);
    expect(await new Response(child.stderr).text()).toBe("");
    expect(existsSync(unexpected)).toBe(false);
  }
);

for (const signal of ["SIGTERM", "SIGKILL"] as const) {
  test.skipIf(!namespaceProbe)(
    `${signal} stops a detached job descendant`,
    async () => {
      const ready = `${signal}-ready`;
      const late = `${signal}-late`;
      const forwarded = `${signal}-forwarded`;
      writeDispatcher(`import os, signal, time
def stop(*args):
    open(${JSON.stringify(forwarded)}, "w").close()
    os._exit(0)
signal.signal(signal.SIGTERM, stop)
if os.fork() == 0:
    os.setsid()
    open(${JSON.stringify(ready)}, "w").close()
    time.sleep(1)
    open(${JSON.stringify(late)}, "w").close()
    os._exit(0)
while True:
    signal.pause()`);
      const child = launch({});
      try {
        await waitFor(ready);
        child.kill(signal);
        expect(await child.exited).toBe(signal === "SIGTERM" ? 143 : 137);
        await delay(1050);
        expect(existsSync(path.join(trusted, forwarded))).toBe(
          signal === "SIGTERM"
        );
        expect(existsSync(path.join(trusted, late))).toBe(false);
      } finally {
        child.kill("SIGKILL");
      }
    }
  );
}

test.skipIf(!namespaceProbe)(
  "forces containment when the dispatcher ignores cancellation",
  async () => {
    writeDispatcher(`import signal
signal.signal(signal.SIGTERM, signal.SIG_IGN)
open("unresponsive-ready", "w").close()
while True:
    signal.pause()`);
    const child = launch({});
    try {
      await waitFor("unresponsive-ready");
      child.kill("SIGTERM");
      expect(await child.exited).toBe(143);
    } finally {
      child.kill("SIGKILL");
    }
  },
  10_000
);

test.skipIf(!namespaceProbe)(
  "the staged dispatcher stops at the protected verifier when the release pin is wrong",
  async () => {
    const install = path.join(fixtureRoot, "release");
    mkdirSync(install);
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["/usr/bin/git", ...args], {
        cwd: install,
        env: {
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          HOME: trusted,
          PATH: "/usr/bin:/bin",
        },
      });
      expect(result.exitCode).toBe(0);
      return result.stdout.toString().trim();
    };
    git("init", "-q");
    writeFileSync(path.join(install, ".bun-version"), `${Bun.version}\n`);
    git("add", ".bun-version");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture"
    );
    git("remote", "add", "origin", "https://github.com/fixture/forge.git");
    const commit = git("rev-parse", "HEAD");
    const attempted = path.join(trusted, "agent-attempted");
    const agent = path.join(trusted, "agent");
    writeFileSync(agent, `#!/bin/sh\ntouch "${attempted}"\nexit 1\n`, {
      mode: 0o700,
    });
    copyFileSync(path.join(staged, "forge-buildkite-dispatch"), dispatcher);
    chmodSync(dispatcher, 0o700);
    const run = async (installCommit: string) => {
      writeFileSync(
        path.join(trusted, "dispatch.json"),
        JSON.stringify({
          ...Object.fromEntries(
            ["organizationId", "pipelineId", "queueId"].map((key) => [
              key,
              fixtureEnv.BUILDKITE_JOB_ID,
            ])
          ),
          agent,
          bun: path.join(path.dirname(process.execPath), "bun"),
          install,
          installCommit,
          organizationSlug: "fixture",
          pipelineSlug: "forge",
          projectQueue: "project",
          repository: "fixture/forge",
          trustedQueue: "trusted",
          verifier: path.join(staged, "verify-trusted-install.sh"),
        })
      );
      const child = launch({});
      expect(await child.exited).toBe(1);
      return new Response(child.stderr).text();
    };
    expect(await run("0".repeat(40))).toBe(
      "Forge trusted install verification failed.\n"
    );
    expect(existsSync(attempted)).toBe(false);
    expect(await run(commit)).toBe(
      "Forge could not authenticate the Buildkite bootstrap job.\n"
    );
    expect(existsSync(attempted)).toBe(true);
  }
);
