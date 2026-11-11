import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { CheckReceipt } from "../src/check-types.ts";
import { cli, fixture } from "./check-fixtures.ts";

const roots: string[] = [];
const processes: number[] = [];
afterEach(() => {
  for (const pid of processes.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* The test may already have reaped it. */
    }
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const start = async (onSignal: string) => {
  const root = fixture(
    `process.on('SIGTERM',()=>{${onSignal}}); require('fs').writeFileSync('.git/child-pid', String(process.pid)); setInterval(()=>{},1000)`
  );
  roots.push(root);
  const child = Bun.spawn([process.execPath, cli, "check"], {
    cwd: root,
    env: { PATH: process.env.PATH },
    stderr: "pipe",
    stdout: "pipe",
  });
  const deadline = Date.now() + 4000;
  while (!existsSync(path.join(root, ".git/child-pid"))) {
    if (Date.now() > deadline) {
      child.kill();
      throw new Error("Child did not start");
    }
    // Bound the wait for actual admission rather than relying on a fixed sleep.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await Bun.sleep(10);
  }
  processes.push(
    Number(readFileSync(path.join(root, ".git/child-pid"), "utf-8"))
  );
  return { child, root };
};

test("cancellation request is separate from an observed graceful exit zero", async () => {
  const { child } = await start("process.exit(0)");
  child.kill("SIGTERM");
  const receipt = JSON.parse(
    await new Response(child.stdout).text()
  ) as CheckReceipt;
  expect(await child.exited).toBe(130);
  expect(receipt).toMatchObject({
    admission: "started",
    cancellation: "SIGTERM",
    completion: "observed",
    exitCode: 0,
    outcome: "canceled",
    signal: null,
  });
});

test("cancellation terminates a signal-ignoring group and observes actual termination", async () => {
  const { child } = await start("");
  child.kill("SIGTERM");
  const receipt = JSON.parse(
    await new Response(child.stdout).text()
  ) as CheckReceipt;
  expect(await child.exited).toBe(130);
  expect(receipt).toMatchObject({
    cancellation: "SIGTERM",
    completion: "observed",
    exitCode: null,
    outcome: "canceled",
    signal: "SIGKILL",
  });
}, 10_000);

test("hard interruption leaves only incomplete publication, never inferred completion or replay safety", async () => {
  const { child, root } = await start("");
  child.kill("SIGKILL");
  await child.exited;
  expect(await new Response(child.stdout).text()).toBe("");
  const store = path.join(root, ".git/forge-check");
  const ids = readdirSync(store);
  expect(ids).toHaveLength(1);
  const receipt = JSON.parse(
    readFileSync(path.join(store, ids[0] ?? "", "receipt.json"), "utf-8")
  ) as CheckReceipt;
  expect(receipt).toMatchObject({
    admission: "unknown",
    completion: "unknown",
    evidence: "unknown",
    finishedAt: null,
    outcome: "unknown",
    recording: { state: "persisted" },
  });
});
