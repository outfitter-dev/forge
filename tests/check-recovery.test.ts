import { expect, test } from "bun:test";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { CheckReceipt } from "../src/check-types.ts";
import { cli, fixture, gitFixture, run } from "./check-fixtures.ts";

test("a fresh check after cancellation preserves the canceled attempt at the same revision", async () => {
  const root = fixture(`
    const fs = require('fs');
    if (fs.existsSync('.git/recovery-ready')) process.exit(0);
    process.on('SIGTERM', () => process.exit(0));
    fs.writeFileSync('.git/started', 'ready');
    setInterval(() => {}, 1000);
  `);
  const head = gitFixture(root, "rev-parse", "HEAD");
  const first = Bun.spawn([process.execPath, cli, "check", "--base", head], {
    cwd: root,
    env: { PATH: process.env.PATH },
    stderr: "pipe",
    stdout: "pipe",
  });
  try {
    const deadline = Date.now() + 4000;
    while (!existsSync(path.join(root, ".git/started"))) {
      if (Date.now() > deadline) {
        throw new Error("Check command did not start");
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      await Bun.sleep(10);
    }
    first.kill("SIGTERM");
    const canceled = JSON.parse(
      await new Response(first.stdout).text()
    ) as CheckReceipt;
    expect(await first.exited).toBe(130);
    expect(canceled).toMatchObject({
      admission: "started",
      cancellation: "SIGTERM",
      completion: "observed",
      exitCode: 0,
      outcome: "canceled",
      recording: { state: "persisted" },
      sourceAfter: { base: head, dirty: false, head },
    });
    const file = canceled.recording.path;
    if (file === null) {
      throw new Error("Canceled receipt was not persisted");
    }
    const original = readFileSync(file, "utf-8");
    // The fixture's next attempt exits normally; no tracked inputs change.
    writeFileSync(path.join(root, ".git/recovery-ready"), "ready");
    const restarted = run(root, ["--base", head]);
    expect(restarted.code).toBe(0);
    expect(restarted.receipt).toMatchObject({
      cancellation: null,
      completion: "observed",
      evidence: "stable",
      outcome: "passed",
      sourceAfter: canceled.sourceAfter,
      sourceBefore: canceled.sourceBefore,
    });
    expect(restarted.receipt.receiptId).not.toBe(canceled.receiptId);
    expect(restarted.receipt.check).toEqual(canceled.check);
    expect(readFileSync(file, "utf-8")).toBe(original);
    expect(readdirSync(path.join(root, ".git/forge-check"))).toHaveLength(2);
  } finally {
    first.kill("SIGKILL");
    await first.exited;
    rmSync(root, { force: true, recursive: true });
  }
});
