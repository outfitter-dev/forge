import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectBuildkiteGateReceipt } from "../src/collect-buildkite-gate-receipt.ts";
import type { GateReceiptCollectionInput } from "../src/collect-buildkite-gate-receipt.ts";

const root = mkdtempSync(path.join(tmpdir(), "forge-receipt-cli-"));
const cli = path.resolve(
  import.meta.dir,
  "../src/buildkite-receipt-collection-cli.ts"
);
const token = "fixture-private-read-token";
const config = path.join(root, "operator.json");
const outputRoot = path.join(root, "output");
const captureRoot = path.join(root, "capture");
mkdirSync(outputRoot, { mode: 0o700 });
mkdirSync(captureRoot, { mode: 0o700 });
writeFileSync(
  config,
  JSON.stringify({
    admission: { jobId: "00000000-0000-4000-8000-000000000001" },
    artifactOrigins: ["https://artifact.example"],
    artifactPath: "receipt.json",
    buildNumber: 1,
    captureRoot,
    expectation: null,
    organizationSlug: "example",
    outputRoot,
    pipelineSlug: "forge",
  })
);
afterAll(() => rmSync(root, { force: true, recursive: true }));

test.each([
  { args: [], env: { FORGE_BUILDKITE_READ_TOKEN: token } },
  { args: [config, "extra"], env: { FORGE_BUILDKITE_READ_TOKEN: token } },
  { args: ["relative.json"], env: { FORGE_BUILDKITE_READ_TOKEN: token } },
  { args: [config], env: {} },
  {
    args: [config],
    env: {
      BUN_CONFIG_VERBOSE_FETCH: "true",
      FORGE_BUILDKITE_READ_TOKEN: token,
    },
  },
])(
  "CLI refuses invalid invocation without exposing credentials %j",
  ({ args, env }) => {
    const child = Bun.spawnSync([process.execPath, cli, ...args], { env });
    expect(child.exitCode).toBe(2);
    expect(new TextDecoder().decode(child.stdout)).not.toContain(token);
    expect(new TextDecoder().decode(child.stderr)).not.toContain(token);
  }
);

test("CLI reads operator roots and refuses missing protected capture before any network request", () => {
  const child = Bun.spawnSync([process.execPath, cli, config], {
    env: { FORGE_BUILDKITE_READ_TOKEN: token },
  });
  expect(child.exitCode).toBe(1);
  expect(JSON.parse(new TextDecoder().decode(child.stdout))).toEqual({
    reason: "capture-unavailable",
    status: "withheld",
  });
  expect(new TextDecoder().decode(child.stderr)).toBe("");
});

test("public output directories are refused before collection", async () => {
  const publicRoot = path.join(root, "public");
  mkdirSync(publicRoot, { mode: 0o755 });
  const supplied = JSON.parse(await Bun.file(config).text());
  const input: GateReceiptCollectionInput = {
    ...supplied,
    outputRoot: publicRoot,
    readToken: token,
  };
  expect(await collectBuildkiteGateReceipt(input)).toEqual({
    reason: "output-unavailable",
    status: "withheld",
  });
});
