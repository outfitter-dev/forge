import { afterEach, expect, test } from "bun:test";

import { gateExitCode } from "../src/gate-document.ts";
import { runGate } from "../src/run-gate.ts";
import { adoption, codexPass } from "./gate-codex-fixtures.ts";
import { gatePolicy, SERVED } from "./gate-fixtures.ts";
import type { ScriptedPass, ScriptedResponse } from "./gate-fixtures.ts";
import {
  cleanupGateWorkspace,
  gateArgs,
  ledgerText,
  seedLedger,
  TOKEN,
  workspace,
} from "./gate-test-harness.ts";
import { registry } from "./review-collection-fixtures.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanupGateWorkspace();
});

const mockSource = (source: ScriptedPass) => {
  const read = (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ): Promise<Response> => {
    const url = new URL(String(input));
    let answer: ScriptedResponse | undefined = source.pullRequest;
    if (url.pathname === "/graphql") {
      const body = JSON.parse(String(init?.body)) as { query: string };
      answer = body.query.includes("reviewThreads(")
        ? source.threads
        : source.comments;
    } else if (url.pathname.endsWith("/reviews")) {
      answer = source.reviews;
    } else if (url.pathname.endsWith("/timeline")) {
      answer = source.timeline;
    }
    return Promise.resolve(
      Response.json(answer?.body ?? {}, {
        headers: { Date: source.pullRequest.date ?? SERVED },
        status: answer?.status ?? 200,
      })
    );
  };
  globalThis.fetch = Object.assign(read, {
    preconnect: originalFetch.preconnect,
  });
};

const configuredPolicy = () => {
  const { reviewer, ...configuration } = adoption({
    findingHistory: "adapter-only",
  });
  return gatePolicy({
    reviewAdapters: [
      { adapter: "codex-github", configuration, reviewer },
      { adapter: "secondary", configuration: {}, reviewer: "local-cli" },
    ],
    schemaVersion: 2,
  });
};

const invoke = async (
  source: ScriptedPass,
  review: unknown = null,
  secondaryOutage = false
) => {
  const ws = workspace();
  seedLedger(ws);
  mockSource(source);
  const document = await runGate({
    adapterRegistry: registry("passed", secondaryOutage),
    args: gateArgs(ws, { policy: configuredPolicy(), review }),
    cwd: ws.work,
    env: { FORGE_GITHUB_TOKEN: TOKEN },
  });
  return { document, ws };
};

test("the real gate evaluates a fallback review with neutral schema-two diagnostics", async () => {
  const source = codexPass({
    comments: {
      body: {
        data: {
          repository: {
            pullRequest: {
              comments: {
                nodes: [],
                pageInfo: { endCursor: null, hasNextPage: false },
              },
            },
          },
        },
      },
    },
  });
  const { document } = await invoke(source);
  expect(gateExitCode(document)).toBe(0);
  expect(document.schemaVersion).toBe(2);
  expect(document).not.toHaveProperty("codexReview");
  if (document.status === "evaluated") {
    expect(
      document.reviewAdapters?.adapters.map((entry) => [
        entry.state,
        entry.selected,
      ])
    ).toEqual([
      ["unavailable", true],
      ["passed", true],
    ]);
  }
});

test("a supplied empty complete ledger cannot erase a newly unreadable source on the real gate path", async () => {
  const { document, ws } = await invoke(
    codexPass({
      comments: { body: { private: "PRIVATE SOURCE ERROR" }, status: 503 },
    }),
    {
      agentReviews: [],
      reviewFindings: { findings: [], recorded: true },
      reviewLadder: null,
    }
  );
  expect(gateExitCode(document)).toBe(1);
  expect(document.status).toBe("evaluated");
  if (
    document.status === "evaluated" &&
    document.evaluation.input.facts.event === "pull_request" &&
    document.evaluation.input.facts.schemaVersion === 2
  ) {
    const pr = document.evaluation.input.facts.pullRequest;
    expect(pr.reviewFindings.recorded).toBe(false);
    expect(document.reviewAdapters?.adapters[1]).toMatchObject({
      selected: true,
      state: "passed",
    });
    expect(
      document.evaluation.gates.find((entry) => entry.name === "agent-review")
        ?.reasons
    ).toContainEqual(expect.objectContaining({ code: "findings-unknown" }));
  }
  expect(JSON.parse(ledgerText(ws)).reviewFindings.recorded).toBe(false);
  expect(JSON.stringify(document)).not.toContain("PRIVATE SOURCE ERROR");
});

test("an outage in a secondary source still blocks a primary clean review in the real gate", async () => {
  const { document } = await invoke(codexPass(), null, true);
  expect(gateExitCode(document)).toBe(1);
  if (document.status === "evaluated") {
    expect(
      document.reviewAdapters?.adapters.map((entry) => [
        entry.state,
        entry.selected,
      ])
    ).toEqual([
      ["passed", true],
      ["unavailable", false],
    ]);
  }
});
