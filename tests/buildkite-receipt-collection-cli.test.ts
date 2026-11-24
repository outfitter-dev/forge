import { afterAll, expect, test } from "bun:test";
import {
  chmodSync,
  readFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

test.each([1, 2])("documented gate hook handles collector exit %i", (exit) => {
  const collector = path.join(root, `collector-${exit}`);
  const gate = path.join(root, `gate-${exit}`);
  const observed = path.join(root, `observed-${exit}`);
  writeFileSync(collector, `#!/bin/sh\nexit ${exit}\n`);
  writeFileSync(gate, '#!/bin/sh\nprintf "%s\\n" "$@" > "$gate_observed"\n');
  chmodSync(collector, 0o700);
  chmodSync(gate, 0o700);
  const document = readFileSync(
    path.resolve(import.meta.dir, "../docs/buildkite-receipt-collection.md"),
    "utf-8"
  );
  const example = document
    .split("## Protected gate handoff")[1]
    ?.split("```sh\n")[1]
    ?.split("```")[0];
  if (!example) {
    throw new Error("Documented gate hook was unavailable");
  }
  const script = example
    .replaceAll("/opt/forge/bootstrap/forge-buildkite-collect", collector)
    .replaceAll("/opt/forge/releases/APPROVED_COMMIT/bin/forge", gate);
  const child = Bun.spawnSync(["/bin/sh", "-c", script], {
    env: {
      admitted_base: "b".repeat(40),
      admitted_head: "a".repeat(40),
      admitted_pr: "1",
      admitted_repository: "example/project",
      admitted_run: "fixture-run",
      collection_result: path.join(root, `result-${exit}`),
      gate_observed: observed,
      qualified_review_evidence: "trusted-review.json",
      trusted_policy: "trusted-policy.json",
      trusted_state: "trusted-state",
    },
  });
  expect(child.exitCode).toBe(exit === 1 ? 0 : 2);
  expect(existsSync(observed)).toBe(exit === 1);
  if (exit === 1) {
    const args = readFileSync(observed, "utf-8").trim().split("\n");
    expect(args).not.toContain("--receipt");
    expect(args).toContain("--expected-head");
    expect(args).toContain("--expected-base");
  }
});
