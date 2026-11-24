import { expect, test } from "bun:test";

import { createBuildkiteStatusPublication } from "../src/buildkite-status-publication.ts";
import type {
  BuildkiteStatusTransport,
  BuildkiteStatusWrite,
} from "../src/buildkite-status-publication.ts";
import type { GateStatusDocument } from "../src/buildkite-status-refresh.ts";
import { evaluateEvidence } from "../src/evaluate-evidence.ts";
import type { GitHubPullRequest } from "../src/github-pull-request-types.ts";
import { passingFactsV2, policyV2 } from "./agent-review-fixtures.ts";
import { BASE, HEAD, REPOSITORY } from "./evidence-fixtures.ts";

const policy = {
  context: "forge/gate",
  head: HEAD,
  holdLabel: "forge:hold",
  repository: REPOSITORY,
};
const pull: GitHubPullRequest = {
  author: { id: 10, login: "fixture", type: "User" },
  base: { ref: "main", repositoryId: 1, repositoryName: REPOSITORY, sha: BASE },
  draft: false,
  head: { ref: "proposal", repositoryId: 1, sha: HEAD },
  labels: [],
  mergeable: true,
  merged: false,
  number: 1,
  requestedReviewers: [],
  requestedTeams: [],
  state: "open",
};
const gateFor = (runId: string, held = false): GateStatusDocument => {
  const facts = passingFactsV2();
  facts.pullRequest.mergeAuthorized = !held;
  const evaluation = evaluateEvidence(facts, policyV2());
  if (evaluation.status !== "evaluated") {
    throw new Error("Invalid fixture");
  }
  return {
    eligible: evaluation.eligible,
    evaluation,
    kind: "forge-gate",
    rejectedReceipts: [],
    runId,
    schemaVersion: 2,
    status: "evaluated",
    subject: {
      baseSha: BASE,
      headSha: HEAD,
      pullRequest: 1,
      repository: REPOSITORY,
    },
  };
};
const attempt = (runId: string) => ({
  evaluate: () => Promise.resolve(gateFor(runId)),
  pullRequest: 1,
  runId,
  targetUrl: "https://buildkite.com/fixture/forge/builds/1",
});
const fixture = () => {
  const writes: BuildkiteStatusWrite[] = [];
  let pulls: GitHubPullRequest[] | null = [pull];
  let latest: BuildkiteStatusWrite | null = null;
  const transport: BuildkiteStatusTransport = {
    latest: () => Promise.resolve(latest),
    pullRequests: () => Promise.resolve(pulls),
    write: (status) => {
      latest = status;
      writes.push(status);
      return Promise.resolve();
    },
  };
  return {
    publisher: createBuildkiteStatusPublication({ ...policy, transport }),
    pulls: (value: GitHubPullRequest[] | null) => {
      pulls = value;
    },
    transport,
    writes,
  };
};

test("a fresh eligible gate is published only after pending and two unique-subject reads", async () => {
  const f = fixture();
  expect(await f.publisher.refresh(attempt("clean"))).toEqual({
    runId: "clean",
    state: "success",
    status: "published",
  });
  expect(f.writes.map(({ state }) => state)).toEqual(["pending", "success"]);
  expect(f.writes[1]).toEqual({
    context: policy.context,
    description: "Forge clean: success",
    head: HEAD,
    repository: REPOSITORY,
    state: "success",
    targetUrl: attempt("clean").targetUrl,
  });
});

test("hold and removal produce fresh nonpassing and passing statuses on the same SHA", async () => {
  const f = fixture();
  await f.publisher.refresh(attempt("clean"));
  f.pulls([{ ...pull, labels: [{ id: 2, name: "forge:hold" }] }]);
  expect(
    await f.publisher.refresh({
      ...attempt("held"),
      evaluate: () => Promise.resolve(gateFor("held", true)),
    })
  ).toMatchObject({ state: "failure", status: "published" });
  f.pulls([pull]);
  expect(await f.publisher.refresh(attempt("unheld"))).toMatchObject({
    state: "success",
    status: "published",
  });
  expect(f.writes.map(({ state }) => state)).toEqual([
    "pending",
    "success",
    "pending",
    "failure",
    "pending",
    "success",
  ]);
  expect(new Set(f.writes.map(({ head }) => head))).toEqual(new Set([HEAD]));
});

test("an older clean evaluation cannot overwrite a newer held decision", async () => {
  const f = fixture();
  const started = Promise.withResolvers<undefined>();
  const old = Promise.withResolvers<GateStatusDocument>();
  const first = f.publisher.refresh({
    ...attempt("old"),
    evaluate: () => {
      started.resolve(undefined);
      return old.promise;
    },
  });
  await started.promise;
  f.pulls([{ ...pull, labels: [{ id: 2, name: "forge:hold" }] }]);
  expect(
    await f.publisher.refresh({
      ...attempt("held"),
      evaluate: () => Promise.resolve(gateFor("held", true)),
    })
  ).toMatchObject({ state: "failure" });
  old.resolve(gateFor("old"));
  expect(await first).toEqual({ reason: "superseded", status: "withheld" });
  expect(f.writes.map(({ state }) => state)).toEqual([
    "pending",
    "pending",
    "failure",
  ]);
});

test.each([null, [], [pull, { ...pull, number: 2 }]].map((pulls) => [pulls]))(
  "missing or shared subject invalidates success without evaluating",
  async (pulls) => {
    const f = fixture();
    await f.publisher.refresh(attempt("clean"));
    f.pulls(pulls);
    let evaluated = false;
    const result = await f.publisher.refresh({
      ...attempt("unknown"),
      evaluate: () => {
        evaluated = true;
        return Promise.resolve(gateFor("unknown"));
      },
    });
    expect(result).toEqual({
      reason: pulls === null ? "subject-unavailable" : "subject-ambiguous",
      status: "withheld",
    });
    expect(evaluated).toBe(false);
    expect(f.writes.at(-1)?.state).toBe("pending");
  }
);

test.each(["read", "gate"] as const)(
  "a failed %s leaves the confirmed pending status",
  async (unavailable) => {
    const f = fixture();
    const result = await f.publisher.refresh({
      ...attempt(unavailable),
      evaluate: () => {
        if (unavailable === "read") {
          f.transport.pullRequests = () =>
            Promise.reject(new Error("private transport detail"));
        }
        return Promise.reject(new Error("private gate detail"));
      },
    });
    expect(result).toEqual({
      reason:
        unavailable === "read" ? "subject-unavailable" : "gate-unavailable",
      status: "withheld",
    });
    expect(f.writes.map(({ state }) => state)).toEqual(["pending"]);
  }
);

test.each(["head", "base", "hold"] as const)(
  "a changed %s during evaluation cannot publish stale success",
  async (change) => {
    const f = fixture();
    const result = await f.publisher.refresh({
      ...attempt(change),
      evaluate: () => {
        f.pulls([
          {
            ...pull,
            ...(change === "head"
              ? { head: { ...pull.head, sha: "c".repeat(40) } }
              : {}),
            ...(change === "base"
              ? { base: { ...pull.base, sha: "c".repeat(40) } }
              : {}),
            ...(change === "hold"
              ? { labels: [{ id: 2, name: "forge:hold" }] }
              : {}),
          },
        ]);
        return Promise.resolve(gateFor(change));
      },
    });
    expect(result.status).toBe("withheld");
    expect(f.writes.map(({ state }) => state)).toEqual(["pending"]);
  }
);

test.each(["pending", "success"] as const)(
  "ambiguous %s delivery is read back and freezes subsequent writes",
  async (state) => {
    const f = fixture();
    const { write } = f.transport;
    f.transport.write = async (value) => {
      await write(value);
      if (value.state === state) {
        throw new Error("connection lost after commit");
      }
    };
    const result = await f.publisher.refresh(attempt("unknown"));
    expect(result).toEqual({
      observed: true,
      readback: { latest: f.writes.at(-1) ?? null, status: "read" },
      reason: "delivery-unknown",
      status: "withheld",
    });
    const count = f.writes.length;
    expect(await f.publisher.refresh(attempt("later"))).toEqual({
      reason: "publisher-stopped",
      status: "withheld",
    });
    expect(f.writes).toHaveLength(count);
  }
);

test("failed pending write reports the previous success observed remotely", async () => {
  const f = fixture();
  await f.publisher.refresh(attempt("clean"));
  const prior = f.writes.at(-1) ?? null;
  f.transport.write = () => Promise.reject(new Error("unavailable"));
  expect(await f.publisher.refresh(attempt("unknown"))).toEqual({
    observed: false,
    readback: { latest: prior, status: "read" },
    reason: "delivery-unknown",
    status: "withheld",
  });
});

test("unreadable delivery remains unknown and is never retried", async () => {
  const f = fixture();
  f.transport.write = () => Promise.reject(new Error("transport"));
  f.transport.latest = () => Promise.reject(new Error("readback"));
  expect(await f.publisher.refresh(attempt("unknown"))).toEqual({
    observed: false,
    readback: { status: "unavailable" },
    reason: "delivery-unknown",
    status: "withheld",
  });
  expect(await f.publisher.refresh(attempt("retry"))).toMatchObject({
    reason: "publisher-stopped",
  });
  expect(f.writes).toHaveLength(0);
});

test("evaluation identifiers cannot be reused within a publisher", async () => {
  const f = fixture();
  await f.publisher.refresh(attempt("same"));
  expect(await f.publisher.refresh(attempt("same"))).toEqual({
    reason: "invalid-input",
    status: "withheld",
  });
  expect(f.writes).toHaveLength(2);
});

test("a refresh requested during the final subject read supersedes the older decision", async () => {
  const f = fixture();
  const reading = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<GitHubPullRequest[]>();
  let reads = 0;
  f.transport.pullRequests = () => {
    reads += 1;
    if (reads === 2) {
      reading.resolve(undefined);
      return release.promise;
    }
    return Promise.resolve([pull]);
  };
  const old = f.publisher.refresh(attempt("old-read"));
  await reading.promise;
  const latest = f.publisher.refresh(attempt("new-read"));
  release.resolve([pull]);
  expect(await old).toEqual({ reason: "superseded", status: "withheld" });
  expect(await latest).toMatchObject({
    runId: "new-read",
    status: "published",
  });
  expect(f.writes.map(({ description }) => description)).toEqual([
    "Forge old-read: pending",
    "Forge new-read: pending",
    "Forge new-read: success",
  ]);
});
