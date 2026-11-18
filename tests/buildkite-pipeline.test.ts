import { expect, test } from "bun:test";
import path from "node:path";

const cli = path.resolve(import.meta.dir, "../src/forge-cli.ts");
const head = "a".repeat(40);
const base = "b".repeat(40);
const queues = [
  "--project-queue",
  "ci-project",
  "--trusted-queue",
  "ci-trusted",
  "--head",
  head,
  "--base",
  base,
];
const run = (args: string[]) =>
  Bun.spawnSync([process.execPath, cli, "buildkite", ...args], { env: {} });

test("emits a native two-lane graph without credentials or ambient configuration", () => {
  const child = run(["pipeline", ...queues]);
  expect(child.exitCode).toBe(0);
  expect(child.stderr.toString()).toBe("");
  const pipeline = JSON.parse(child.stdout.toString());
  expect(pipeline.steps).toHaveLength(2);
  expect(pipeline.steps[0]).toMatchObject({
    agents: { queue: "ci-project", role: "project" },
    checkout: { skip: true },
    env: {
      FORGE_BASE_SHA: base,
      FORGE_BUILDKITE_TASK: "check",
      FORGE_HEAD_SHA: head,
    },
    key: "forge-check",
  });
  expect(pipeline.steps[1]).toMatchObject({
    agents: { queue: "ci-trusted", role: "trusted" },
    allow_dependency_failure: true,
    checkout: { skip: true },
    depends_on: ["forge-check"],
    env: {
      FORGE_BASE_SHA: base,
      FORGE_BUILDKITE_TASK: "gate",
      FORGE_HEAD_SHA: head,
    },
    key: "forge-gate",
  });
  for (const step of pipeline.steps) {
    expect(step.notify).toBeUndefined();
    expect(step.plugins).toBeUndefined();
    expect(step.soft_fail).toBeUndefined();
    expect(Object.keys(step.env)).toEqual([
      "FORGE_BASE_SHA",
      "FORGE_BUILDKITE_TASK",
      "FORGE_HEAD_SHA",
    ]);
  }
});

test("each command fails when the worker has no command hook", () => {
  const pipeline = JSON.parse(run(["pipeline", ...queues]).stdout.toString());
  for (const step of pipeline.steps) {
    const child = Bun.spawnSync(["/bin/sh", "-c", step.command], { env: {} });
    expect(child.exitCode).toBe(1);
    expect(child.stdout.toString()).toBe("");
    expect(child.stderr.toString()).toContain("command hook is required");
  }
});

test.each(["--head", "--base"])(
  "requires a full lowercase commit for %s",
  (flag) => {
    for (const value of [
      "",
      "HEAD",
      "a".repeat(39),
      "a".repeat(41),
      "A".repeat(40),
      "g".repeat(40),
    ]) {
      const args = [...queues];
      args[args.indexOf(flag) + 1] = value;
      const child = run(["pipeline", ...args]);
      expect(child.exitCode).toBe(2);
      expect(child.stdout.toString()).toBe("");
    }
    const args = [...queues];
    args.splice(args.indexOf(flag), 2);
    const child = run(["pipeline", ...args]);
    expect(child.exitCode).toBe(2);
    expect(child.stdout.toString()).toBe("");
  }
);

test.each([
  [],
  ["other", ...queues],
  ["pipeline"],
  ["pipeline", "--project-queue", "ci-project"],
  ["pipeline", ...queues, "--trusted-queue", "duplicate"],
  ["pipeline", ...queues, "--unknown", "value"],
  ["pipeline", ...queues, "extra"],
  ["pipeline", "--project-queue", "", "--trusted-queue", "ci-trusted"],
  ["pipeline", "--project-queue", "--trusted-queue", "ci-trusted"],
  [
    "pipeline",
    "--project-queue",
    "ci project",
    "--trusted-queue",
    "ci-trusted",
  ],
  [
    "pipeline",
    "--project-queue",
    "PRIVATE_MARKER;exit",
    "--trusted-queue",
    "ci",
  ],
])(
  "invalid invocation %p emits no uploadable document",
  (...args: string[]) => {
    const child = run(args);
    expect(child.exitCode).toBe(2);
    expect(child.stdout.toString()).toBe("");
    expect(child.stderr.toString()).toContain(
      "Usage: forge buildkite pipeline"
    );
    expect(child.stderr.toString()).not.toContain("PRIVATE_MARKER");
  }
);
