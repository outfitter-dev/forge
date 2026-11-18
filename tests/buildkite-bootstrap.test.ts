import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildkiteBootstrap } from "../src/buildkite-bootstrap.ts";
import { BASE, HEAD, pullRequestResponse } from "./github-fixtures.ts";

const args = [
  "--repository",
  "example/project",
  "--pull-request",
  "12",
  "--commit",
  HEAD,
  "--project-queue",
  "ci-project",
  "--trusted-queue",
  "ci-trusted",
];
const run = (body: unknown, givenArgs = args) =>
  buildkiteBootstrap({
    args: givenArgs,
    env: { FORGE_GITHUB_TOKEN: "offline-token" },
    fetch: (url, init) => {
      expect(url).toBe("https://api.github.com/repos/example/project/pulls/12");
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("error");
      return Promise.resolve(
        Response.json(body, {
          headers: { Date: "Wed, 18 Nov 2026 20:00:00 GMT" },
        })
      );
    },
  });

test("admits same-repository open PRs and uses GitHub's revision pair for both lanes", async () => {
  const result = await run(pullRequestResponse({ draft: true }));
  expect(result.exitCode).toBe(0);
  if (result.exitCode === 0) {
    expect(result.pipeline?.steps.map((step) => step.env)).toEqual([
      {
        FORGE_BASE_SHA: BASE,
        FORGE_BUILDKITE_TASK: "check",
        FORGE_HEAD_SHA: HEAD,
      },
      {
        FORGE_BASE_SHA: BASE,
        FORGE_BUILDKITE_TASK: "gate",
        FORGE_HEAD_SHA: HEAD,
      },
    ]);
  }
});

test.each([
  { state: "closed" },
  { merged: true },
  { number: 13 },
  { head: { ref: "feature", repo: { id: 101 }, sha: HEAD } },
  { head: { ref: "feature", repo: null, sha: HEAD } },
  { head: { ref: "feature", repo: { id: 100 }, sha: "c".repeat(40) } },
  {
    base: {
      ref: "main",
      repo: { full_name: "example/other", id: 100 },
      sha: BASE,
    },
  },
  {
    base: {
      ref: "main",
      repo: { full_name: "example/project", id: 100 },
      sha: "main",
    },
  },
])("refuses an ineligible or malformed PR %p", async (change) => {
  const result = await run(pullRequestResponse(change));
  expect(result.exitCode).toBe(3);
  expect(result).not.toHaveProperty("pipeline");
});

test.each(
  [
    [],
    [...args, "--commit", HEAD],
    [...args, "--base", BASE],
    args.map((value) => (value === "ci-trusted" ? "ci-project" : value)),
    args.map((value) => (value === "12" ? "012" : value)),
    args.map((value) => (value === HEAD ? "HEAD" : value)),
  ].map((givenArgs) => ({ givenArgs }))
)(
  "rejects invalid arguments before reading GitHub %p",
  async ({ givenArgs }) => {
    let calls = 0;
    const result = await buildkiteBootstrap({
      args: givenArgs,
      env: { FORGE_GITHUB_TOKEN: "offline-token" },
      fetch: () => {
        calls += 1;
        throw new Error("PRIVATE_MARKER");
      },
    });
    expect(result.exitCode).toBe(2);
    expect(calls).toBe(0);
  }
);

test("unavailable GitHub does not emit a graph or leak the underlying error", async () => {
  const result = await buildkiteBootstrap({
    args,
    env: { FORGE_GITHUB_TOKEN: "offline-token" },
    fetch: () => {
      throw new Error("PRIVATE_MARKER");
    },
  });
  expect(result.exitCode).toBe(3);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER");
  expect(result).not.toHaveProperty("pipeline");
});

test("CLI leaves stdout empty without a host credential", () => {
  const child = Bun.spawnSync(
    [
      process.execPath,
      path.resolve(import.meta.dir, "../src/forge-cli.ts"),
      "buildkite",
      "bootstrap",
      ...args,
    ],
    { env: {} }
  );
  expect(child.exitCode).toBe(2);
  expect(child.stdout.toString()).toBe("");
  expect(child.stderr.toString()).toContain("credential is required");
});

test("CLI emits the admitted graph and keeps refused admissions off stdout", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "forge-bootstrap-"));
  try {
    const preload = path.join(directory, "fetch.ts");
    writeFileSync(
      preload,
      `globalThis.fetch = () => Promise.resolve(Response.json(JSON.parse(process.env.FIXTURE!), {headers:{Date:"Wed, 18 Nov 2026 20:00:00 GMT"}}));`
    );
    for (const state of ["open", "closed"]) {
      const child = Bun.spawnSync(
        [
          process.execPath,
          "--preload",
          preload,
          path.resolve(import.meta.dir, "../src/forge-cli.ts"),
          "buildkite",
          "bootstrap",
          ...args,
        ],
        {
          env: {
            FIXTURE: JSON.stringify(pullRequestResponse({ state })),
            FORGE_GITHUB_TOKEN: "offline-token",
          },
        }
      );
      if (state === "open") {
        expect(child.exitCode).toBe(0);
        expect(
          JSON.parse(child.stdout.toString()).steps[0].env.FORGE_BASE_SHA
        ).toBe(BASE);
        expect(child.stderr.toString()).toBe("");
      } else {
        expect(child.exitCode).toBe(3);
        expect(child.stdout.toString()).toBe("");
        expect(child.stderr.toString()).toContain("admission refused");
      }
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test.each(["", "example/../project", "https://github.com/example/project"])(
  "invalid repository %p fails before network access",
  async (repository) => {
    const given = [...args];
    given[given.indexOf("--repository") + 1] = repository;
    const result = await buildkiteBootstrap({
      args: given,
      env: { FORGE_GITHUB_TOKEN: "offline-token" },
      fetch: () => {
        throw new Error("must not read");
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result).not.toHaveProperty("pipeline");
  }
);

test.each(["", "0", "1", "curl"])(
  "CLI refuses verbose fetch %p before reading or logging a token",
  (value) => {
    const child = Bun.spawnSync(
      [
        process.execPath,
        path.resolve(import.meta.dir, "../src/forge-cli.ts"),
        "buildkite",
        "bootstrap",
        ...args,
      ],
      {
        env: {
          BUN_CONFIG_VERBOSE_FETCH: value,
          FORGE_GITHUB_TOKEN: "PRIVATE_TOKEN_MARKER",
        },
      }
    );
    expect(child.exitCode).toBe(2);
    expect(child.stdout.toString()).toBe("");
    expect(child.stderr.toString()).toBe(
      "BUN_CONFIG_VERBOSE_FETCH must be unset.\n"
    );
  }
);
