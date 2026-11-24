import { expect, test } from "bun:test";

import { digest } from "../src/check-config.ts";
import { collectBuildkiteReceipt } from "../src/collect-buildkite-receipt.ts";
import { receipt } from "./check-fixtures.ts";
import { BASE, HEAD, REPOSITORY } from "./evidence-fixtures.ts";

const uuid = (digit: number) => `00000000-0000-4000-8000-00000000000${digit}`;
const observed = receipt();
const bytes = new TextEncoder().encode(`${JSON.stringify(observed)}\n`);
const admission = {
  base: BASE,
  buildId: uuid(1),
  head: HEAD,
  jobId: uuid(2),
  organizationId: uuid(3),
  pipelineId: uuid(4),
  pullRequest: 12,
  queueId: uuid(5),
  repository: REPOSITORY,
};
const job = {
  cluster_queue_id: admission.queueId,
  exit_status: 0,
  id: admission.jobId,
  matrix: null,
  parallel_group_total: null,
  retried: false,
  retried_in_job_id: null,
  soft_failed: false,
  state: "passed",
  step_key: "forge-check",
  type: "script",
};
const build = {
  commit: admission.head,
  id: admission.buildId,
  jobs: [job],
  number: 42,
  pipeline: {
    id: admission.pipelineId,
    repository: `https://github.com/${admission.repository}.git`,
    slug: "forge",
  },
  pull_request: {
    id: String(admission.pullRequest),
    repository: `https://github.com/${admission.repository}.git`,
  },
  source: "webhook",
  state: "running",
};
const artifact = {
  download_url: "https://attacker.invalid/never-use",
  file_size: bytes.byteLength,
  id: uuid(6),
  job_id: admission.jobId,
  path: "forge/receipt.json",
  state: "finished",
};
const input = {
  admission,
  artifactOrigins: ["https://storage.example.invalid"],
  artifactPath: artifact.path,
  buildNumber: 42,
  capture: {
    jobId: admission.jobId,
    receiptSha256: digest(bytes),
    runnerExitCode: 0,
  },
  expectation: {
    checks: { build: "check", lint: "check", test: "check" },
    commandDigest: "f".repeat(64),
    configDigest: "e".repeat(64),
    provenance: {
      producer: "protected-runner",
      runtimeFingerprint: "f".repeat(64),
    },
    runtime: observed.runtime,
  },
  organizationSlug: "outfitter",
  pipelineSlug: "forge",
  readToken: "private-api-token",
};

const json = (value: unknown) => Response.json(value);
interface Scenario {
  after?: unknown;
  artifacts?: unknown;
  artifactPage?: (page: number) => unknown;
  before?: unknown;
  download?: Response;
  storage?: () => Response;
}
const transport = (scenario: Scenario = {}) => {
  const calls: {
    url: string;
    authorization: string | null;
    redirect: unknown;
  }[] = [];
  let builds = 0;
  const request = (async (url, init) => {
    await Promise.resolve();
    const target = String(url);
    calls.push({
      authorization: new Headers(init?.headers).get("Authorization"),
      redirect: init?.redirect,
      url: target,
    });
    if (target.endsWith("/builds/42")) {
      builds += 1;
      return json(
        builds === 1 ? (scenario.before ?? build) : (scenario.after ?? build)
      );
    }
    if (target.includes("?per_page=")) {
      const page = Number(new URL(target).searchParams.get("page"));
      return json(
        scenario.artifactPage?.(page) ?? scenario.artifacts ?? [artifact]
      );
    }
    if (target.endsWith("/download")) {
      return (
        scenario.download ??
        new Response(null, {
          headers: {
            Location:
              "https://storage.example.invalid/exact-receipt?signature=private",
          },
          status: 302,
        })
      );
    }
    if (target.startsWith("https://storage.example.invalid/")) {
      return scenario.storage?.() ?? new Response(bytes);
    }
    throw new Error("Unexpected transport URL");
  }) as typeof fetch;
  return { calls, request };
};
const collect = (
  scenario: Scenario = {},
  overrides: Partial<typeof input> = {}
) => {
  const mock = transport(scenario);
  return {
    ...mock,
    result: collectBuildkiteReceipt({
      ...input,
      ...overrides,
      request: mock.request,
    }),
  };
};

test("collects one current job's artifact, rereads the attempt and qualifies exact bytes", async () => {
  const { result, calls } = collect();
  const output = await result;
  expect(output.collected).toBe(true);
  if (!output.collected) {
    throw new Error("collection failed");
  }
  expect(output.receipt).toEqual(bytes);
  expect(output.verification).toMatchObject({
    checks: expect.arrayContaining([
      expect.objectContaining({ state: "passed" }),
    ]),
    verified: true,
  });
  expect(calls.filter((call) => call.url.endsWith("/builds/42"))).toHaveLength(
    2
  );
  expect(
    calls.find((call) => call.url.startsWith("https://storage."))
  ).toMatchObject({ authorization: null, redirect: "error" });
  expect(calls.some((call) => call.url.includes("attacker"))).toBe(false);
  expect(
    calls
      .slice(0, 3)
      .every((call) => call.authorization === "Bearer private-api-token")
  ).toBe(true);
});

test.each([
  ["duplicate current steps", { jobs: [job, job] }],
  ["previous attempt", { jobs: [{ ...job, id: uuid(7) }] }],
  [
    "retried attempt",
    { jobs: [{ ...job, retried: true, retried_in_job_id: uuid(7) }] },
  ],
  ["parallel job", { jobs: [{ ...job, parallel_group_total: 2 }] }],
  ["wrong queue", { jobs: [{ ...job, cluster_queue_id: uuid(7) }] }],
  ["wrong source", { source: "api" }],
  ["wrong head", { commit: "f".repeat(40) }],
])("rejects %s before reading an artifact", async (_name, override) => {
  const { result, calls } = collect({ before: { ...build, ...override } });
  expect(await result).toMatchObject({ collected: false });
  expect(calls).toHaveLength(1);
});

test.each(["failed", "canceled", "running"])(
  "rejects a %s job without artifact reads",
  async (state) => {
    const { result, calls } = collect({
      before: { ...build, jobs: [{ ...job, state }] },
    });
    expect(await result).toEqual({
      collected: false,
      reason: "job-nonpassing",
    });
    expect(calls).toHaveLength(1);
  }
);

test("a retry appearing during artifact transfer cannot qualify the old success", async () => {
  const { result } = collect({
    after: { ...build, jobs: [{ ...job, id: uuid(7), state: "running" }] },
  });
  expect(await result).toEqual({ collected: false, reason: "job-mismatch" });
});

test.each([
  { artifacts: [] },
  { artifacts: [artifact, artifact] },
  { artifacts: [{ ...artifact, state: "new" }] },
  { artifacts: [{ ...artifact, job_id: uuid(7) }] },
  { artifacts: [{ ...artifact, file_size: 65_537 }] },
])(
  "rejects missing, ambiguous or mismatched artifact metadata %#",
  async ({ artifacts }) => {
    const { result, calls } = collect({ artifacts });
    expect(await result).toEqual({
      collected: false,
      reason: "artifact-mismatch",
    });
    expect(calls).toHaveLength(2);
  }
);

test("storage redirect is denied unless its origin is explicitly configured", async () => {
  const { result, calls } = collect({
    download: new Response(null, {
      headers: { Location: "https://attacker.invalid/receipt" },
      status: 302,
    }),
  });
  expect(await result).toEqual({
    collected: false,
    reason: "artifact-origin-denied",
  });
  expect(calls).toHaveLength(3);
});

test("streaming download is bounded even when metadata understates the size", async () => {
  const { result } = collect({
    storage: () => new Response(new Uint8Array(65_537)),
  });
  expect(await result).toEqual({ collected: false, reason: "read-too-large" });
});

test("artifact bytes cannot replace the authoritative capture digest", async () => {
  const { result } = collect(
    {},
    { capture: { ...input.capture, receiptSha256: "f".repeat(64) } }
  );
  const output = await result;
  expect(output).toMatchObject({
    collected: true,
    receipt: null,
    verification: { reason: "receipt-digest-mismatch", verified: false },
  });
});

test("qualified job with unavailable execution expectations withholds raw bytes", async () => {
  const mock = transport();
  const output = await collectBuildkiteReceipt({
    ...input,
    expectation: null,
    request: mock.request,
  });
  expect(output).toMatchObject({
    collected: true,
    receipt: null,
    verification: {
      checks: [],
      reason: "expectation-unavailable",
      verified: true,
    },
  });
});

test("transport diagnostics never expose tokens, signed URLs or service bodies", async () => {
  const request = (() =>
    Promise.resolve(
      new Response("private-api-token", { status: 403 })
    )) as unknown as typeof fetch;
  const output = await collectBuildkiteReceipt({ ...input, request });
  expect(output).toEqual({ collected: false, reason: "read-denied" });
});

test("artifact selection reads later pages and refuses a duplicate there", async () => {
  const filler = Array.from({ length: 99 }, (_, index) => ({
    ...artifact,
    path: `other-${index}`,
  }));
  const { result, calls } = collect({
    artifactPage: (page) => (page === 1 ? [artifact, ...filler] : [artifact]),
  });
  expect(await result).toEqual({
    collected: false,
    reason: "artifact-mismatch",
  });
  expect(calls.filter((call) => call.url.includes("?per_page="))).toHaveLength(
    2
  );
});

test("a full artifact listing at the page bound refuses incomplete coverage", async () => {
  const full = Array.from({ length: 100 }, (_, index) => ({
    ...artifact,
    path: `other-${index}`,
  }));
  const { result, calls } = collect({ artifacts: full });
  expect(await result).toEqual({
    collected: false,
    reason: "artifact-page-limit",
  });
  expect(calls).toHaveLength(11);
});

test("download aborts and cancels its stream when chunks exceed the receipt bound", async () => {
  let canceled = false;
  const { result } = collect({
    storage: () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
          start(controller) {
            controller.enqueue(new Uint8Array(65_536));
            controller.enqueue(new Uint8Array(1));
          },
        })
      ),
  });
  expect(await result).toEqual({ collected: false, reason: "read-too-large" });
  expect(canceled).toBe(true);
});

test("a changed successful job outcome is rechecked before handing off bytes", async () => {
  const { result } = collect({
    after: { ...build, jobs: [{ ...job, soft_failed: true }] },
  });
  expect(await result).toEqual({ collected: false, reason: "job-changed" });
});

test("a refused storage redirect cannot retry with the Buildkite credential", async () => {
  const { result, calls } = collect({
    storage: () =>
      new Response(null, {
        headers: { Location: "https://other.invalid" },
        status: 302,
      }),
  });
  expect(await result).toEqual({
    collected: false,
    reason: "artifact-download-unavailable",
  });
  expect(calls.at(-1)?.authorization).toBeNull();
});
