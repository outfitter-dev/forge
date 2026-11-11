import { expect, test } from "bun:test";

import { observeNpmPublications } from "../src/index.ts";
import type {
  NpmEvidenceIO,
  NpmPublication,
  NpmRegistryRead,
} from "../src/index.ts";
import {
  fixtureDist,
  found,
  metadata,
  npmPolicy,
  publication,
} from "./npm-fixtures.ts";

const clock = (
  read: (
    name: string,
    signal: AbortSignal
  ) => NpmRegistryRead | Promise<NpmRegistryRead>
) => {
  let time = 0;
  const sleeps: number[] = [];
  const io: NpmEvidenceIO = {
    now: () => time,
    read: (name, signal) => Promise.resolve(read(name, signal)),
    sleep: (ms) => {
      sleeps.push(ms);
      time += ms;
      return Promise.resolve();
    },
  };
  return {
    advance: (ms: number) => {
      time += ms;
    },
    io,
    sleeps,
  };
};

test("slow propagation beyond 30 seconds recovers without a publish capability", async () => {
  let reads = 0;
  const fixture = clock(() => {
    reads += 1;
    return reads < 5 ? { status: "not-found" } : found();
  });
  const result = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io
  );
  expect(result.complete).toBe(true);
  expect(result.attempts).toBe(5);
  expect(fixture.sleeps).toEqual([3000, 6000, 12_000, 24_000]);
  expect(result.provenanceVerification).toBe("reference-only");
});

test("partial set remains incomplete, with matching packages and missing suffix visible", async () => {
  const a = publication("@example/a");
  const b = publication("@example/b");
  const fixture = clock((name) =>
    name === a.name ? found(a) : { status: "not-found" }
  );
  const result = await observeNpmPublications(
    [a, b],
    { ...npmPolicy(), maxAttempts: 2 },
    fixture.io
  );
  expect(result.complete).toBe(false);
  expect(result.stopped).toBe("attempt-limit");
  expect(result.packages.map((item) => item.state)).toEqual([
    "complete",
    "incomplete",
  ]);
});

test("every coordinated attempt recollects all packages rather than reusing a stale completed tag", async () => {
  const a = publication("@example/a");
  const b = publication("@example/b");
  const counts = new Map<string, number>();
  const fixture = clock((name) => {
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    const visible = name === a.name ? count === 1 : count === 2;
    return visible ? found(name === a.name ? a : b) : { status: "not-found" };
  });
  const result = await observeNpmPublications(
    [a, b],
    { ...npmPolicy(), maxAttempts: 2 },
    fixture.io
  );
  expect(result.complete).toBe(false);
  expect(result.packages.map((item) => item.state)).toEqual([
    "incomplete",
    "complete",
  ]);
  expect([...counts.values()]).toEqual([2, 2]);
});

test("an occupied artifact mismatch blocks immediately and is not retried as propagation", async () => {
  const doc = metadata();
  fixtureDist(doc).integrity =
    `sha512-${Buffer.alloc(64, 2).toString("base64")}`;
  const fixture = clock(() => ({ document: doc, status: "found" }));
  const result = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io
  );
  expect(result).toMatchObject({
    attempts: 1,
    complete: false,
    packages: [{ state: "conflict" }],
    stopped: "blocked",
  });
  expect(fixture.sleeps).toEqual([]);
});

test.each([
  "authentication",
  "rate-limit",
  "network",
  "registry-error",
] as const)(
  "unavailable %s never becomes missing or complete",
  async (reason) => {
    const fixture = clock(() => ({ reason, status: "unavailable" }));
    const result = await observeNpmPublications(
      [publication()],
      npmPolicy(),
      fixture.io
    );
    expect(result).toMatchObject({
      attempts: 1,
      complete: false,
      packages: [{ reasons: [reason], state: "unavailable" }],
      stopped: "blocked",
    });
    expect(fixture.sleeps).toEqual([]);
  }
);

test("thrown transport errors are sanitized", async () => {
  const fixture = clock(() => {
    throw new Error("private-token-must-not-escape");
  });
  const result = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io
  );
  expect(result.complete).toBe(false);
  expect(result.packages[0]).toEqual({
    reasons: ["network"],
    state: "unavailable",
  });
  expect(JSON.stringify(result)).not.toContain("private-token");
});

test("malformed transport data blocks without continuing", async () => {
  const fixture = clock(() => ({ document: [], status: "found" }));
  const result = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io
  );
  expect(result).toMatchObject({
    attempts: 1,
    complete: false,
    packages: [{ state: "invalid" }],
    stopped: "blocked",
  });
});

test("an explicit time budget stops fake-clock retries at its boundary", async () => {
  const fixture = clock(() => ({ status: "not-found" }));
  const result = await observeNpmPublications(
    [publication()],
    {
      ...npmPolicy(),
      initialDelayMs: 3000,
      maxDelayMs: 6000,
      timeoutMs: 10_000,
    },
    fixture.io
  );
  expect(result).toMatchObject({
    attempts: 3,
    complete: false,
    stopped: "deadline",
  });
  expect(fixture.sleeps).toEqual([3000, 6000, 1000]);
});

test("a result arriving beyond the time budget cannot pass", async () => {
  const fixture = clock(() => {
    fixture.advance(900_001);
    return found();
  });
  const result = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io
  );
  expect(result).toMatchObject({ complete: false, stopped: "deadline" });
});

test("external abort stops waiting even when the read ignores its signal", async () => {
  const cancel = new AbortController();
  let started = false;
  const fixture = clock(() => {
    started = true;
    cancel.abort();
    return Promise.withResolvers<NpmRegistryRead>().promise;
  });
  const result = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io,
    cancel.signal
  );
  expect(started).toBe(true);
  expect(result).toMatchObject({ complete: false, stopped: "aborted" });
});

test("a pre-aborted invocation performs no registry reads", async () => {
  const cancel = new AbortController();
  cancel.abort();
  let reads = 0;
  const fixture = clock(() => {
    reads += 1;
    return found();
  });
  const result = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io,
    cancel.signal
  );
  expect(result.stopped).toBe("aborted");
  expect(reads).toBe(0);
});

test("duplicate, empty and sparse manifests or invalid budgets perform no IO", async () => {
  let reads = 0;
  const fixture = clock(() => {
    reads += 1;
    return found();
  });
  const sparse: NpmPublication[] = [];
  sparse.length = 1;
  for (const manifest of [[], [publication(), publication()], sparse]) {
    // oxlint-disable-next-line no-await-in-loop -- Invalid calls are checked independently for zero IO.
    const result = await observeNpmPublications(
      manifest,
      npmPolicy(),
      fixture.io
    );
    expect(result.stopped).toBe("invalid-input");
  }
  for (const policy of [
    { ...npmPolicy(), maxAttempts: 0 },
    { ...npmPolicy(), maxAttempts: 1001 },
    { ...npmPolicy(), initialDelayMs: 40_000, maxDelayMs: 30_000 },
    { ...npmPolicy(), timeoutMs: Number.POSITIVE_INFINITY },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Invalid calls are checked independently for zero IO.
    const result = await observeNpmPublications(
      [publication()],
      policy,
      fixture.io
    );
    expect(result.stopped).toBe("invalid-input");
  }
  expect(reads).toBe(0);
});

test("caller mutation cannot retarget an in-flight observation", async () => {
  const expected = publication();
  const original = { ...expected };
  const policy = npmPolicy();
  const fixture = clock(() => {
    expected.name = "@changed/name";
    policy.provenancePredicateType = "changed";
    return found(original);
  });
  const result = await observeNpmPublications([expected], policy, fixture.io);
  expect(result.complete).toBe(true);
  expect(result.publications).toEqual([original]);
  expect(result.policy?.provenancePredicateType).toBe(
    npmPolicy().provenancePredicateType
  );
});

test("a non-advancing clock is still bounded by attempts; a regressing clock is invalid", async () => {
  const fixture = clock(() => ({ status: "not-found" }));
  fixture.io.sleep = () => Promise.resolve();
  const bounded = await observeNpmPublications(
    [publication()],
    { ...npmPolicy(), maxAttempts: 2 },
    fixture.io
  );
  expect(bounded.stopped).toBe("attempt-limit");
  fixture.io.sleep = () => {
    fixture.advance(-1);
    return Promise.resolve();
  };
  const regressed = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io
  );
  expect(regressed.stopped).toBe("invalid-input");
});

test("unsupported policy requirements and expectation fields are rejected without echoing them", async () => {
  let reads = 0;
  const fixture = clock(() => {
    reads += 1;
    return found();
  });
  const policy = Object.assign(npmPolicy(), {
    requireAuthenticatedProvenance: true,
    secret: "do-not-echo",
  });
  const result = await observeNpmPublications(
    [publication()],
    policy,
    fixture.io
  );
  expect(result).toMatchObject({
    complete: false,
    policy: null,
    stopped: "invalid-input",
  });
  expect(JSON.stringify(result)).not.toContain("do-not-echo");
  const extra = Object.assign(publication(), { secret: "do-not-echo" });
  const invalid = await observeNpmPublications(
    [extra],
    npmPolicy(),
    fixture.io
  );
  expect(invalid.stopped).toBe("invalid-input");
  expect(JSON.stringify(invalid)).not.toContain("do-not-echo");
  expect(reads).toBe(0);
});

test("a partial set can finish once all exact artifact evidence arrives", async () => {
  const a = publication("@example/a");
  const b = publication("@example/b");
  let reads = 0;
  const fixture = clock((name) => {
    reads += 1;
    if (name === b.name && reads <= 2) {
      return { status: "not-found" };
    }
    return found(name === a.name ? a : b);
  });
  const result = await observeNpmPublications([a, b], npmPolicy(), fixture.io);
  expect(result.complete).toBe(true);
  expect(result.attempts).toBe(2);
  expect(reads).toBe(4);
});

test("throwing clocks and failed sleeps cannot leak exceptions or complete", async () => {
  const fixture = clock(() => ({ status: "not-found" }));
  fixture.io.sleep = () => Promise.reject(new Error("private-sleep-error"));
  const failedSleep = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io
  );
  expect(failedSleep).toMatchObject({ complete: false, stopped: "blocked" });
  fixture.io.now = () => {
    throw new Error("private-clock-error");
  };
  const failedClock = await observeNpmPublications(
    [publication()],
    npmPolicy(),
    fixture.io
  );
  expect(failedClock).toMatchObject({
    complete: false,
    stopped: "invalid-input",
  });
  expect(JSON.stringify([failedSleep, failedClock])).not.toContain("private-");
});
