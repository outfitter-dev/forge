import { afterEach, expect, test } from "bun:test";

import type { ReviewFinding } from "../src/evidence-types.ts";
import { HOSTED } from "./agent-review-fixtures.ts";
import {
  actor,
  connection,
  findingPass,
  findingSource,
  findingSources,
  invoke,
  pageInfo,
  report,
  reportingThread,
  scopedPolicy,
  sourceComments,
} from "./finding-sources-gate-fixtures.ts";
import {
  BOT,
  codexPass,
  codexPolicy,
  comment,
  thread,
  threads,
} from "./gate-codex-fixtures.ts";
import {
  cleanupGateWorkspace,
  evaluated,
  gate,
  gateArgs,
  ledgerText,
  run,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";

afterEach(cleanupGateWorkspace);
const stored = (ws: ReturnType<typeof workspace>): ReviewFinding[] =>
  JSON.parse(ledgerText(ws)).reviewFindings.findings;
const scopedThreadPass = (isResolved: boolean, accountId = BOT) =>
  findingPass({
    findingThreads: {
      body: connection("reviewThreads", [
        reportingThread({
          comments: {
            nodes: [
              report({
                author: actor(accountId),
                body: "A native finding",
                id: "CODEX_THREAD_COMMENT",
              }),
            ],
            pageInfo,
          },
          id: "T1",
          isResolved,
        }),
      ]),
    },
    threads: { body: threads(thread(isResolved)) },
  });
const origin = ({ resolution: _resolution, ...finding }: ReviewFinding) =>
  finding;

test("Codex reviewing and reporting share one scoped thread origin through resolve and reopen", () => {
  const ws = workspace();
  seedLedger(ws);
  const opened = invoke(ws, [scopedThreadPass(false)]);
  expect(opened.exitCode).toBe(1);
  expect(stored(ws)).toHaveLength(1);
  const [original] = stored(ws);
  expect(original).toMatchObject({
    id: "T1",
    reportingSource: { accountId: BOT },
    resolution: null,
    reviewer: HOSTED,
  });
  const resolved = invoke(ws, [scopedThreadPass(true)]);
  expect(resolved.exitCode).toBe(0);
  expect(stored(ws)).toHaveLength(1);
  expect(stored(ws)[0]).toMatchObject({
    ...original,
    resolution: { kind: "configured-native" },
  });
  const reopened = invoke(ws, [scopedThreadPass(false)]);
  expect(reopened.exitCode).toBe(1);
  expect(stored(ws)[0]?.resolution).toBeNull();
});

test("a persisted legacy Codex thread can clear only through exact current account proof", () => {
  const ws = workspace();
  seedLedger(ws);
  const legacy = run(
    ws,
    gateArgs(ws, { policy: codexPolicy(), review: null }),
    {
      script: { passes: [codexPass({ threads: { body: threads(thread()) } })] },
    }
  );
  expect(legacy.exitCode).toBe(1);
  const [original] = stored(ws);
  if (original === undefined) {
    throw new Error("legacy fixture did not retain a finding");
  }
  expect(original.reportingSource).toBeUndefined();
  const resolved = invoke(ws, [scopedThreadPass(true)]);
  expect(resolved.exitCode).toBe(0);
  const [current] = stored(ws);
  if (current === undefined) {
    throw new Error("scoped fixture erased its finding");
  }
  expect(origin(current)).toEqual(origin(original));
  expect(current.resolution?.kind).toBe("configured-native");
  const pendingComment = comment({ status: "in_progress" });
  const pending = invoke(ws, [
    {
      ...scopedThreadPass(true),
      comments: sourceComments({
        ...pendingComment,
        body: String(pendingComment.body)
          .replace("private-code-review-body", "")
          .trim(),
      }),
    },
  ]);
  expect(pending.exitCode).toBe(1);
  const reopened = invoke(ws, [scopedThreadPass(false)]);
  expect(reopened.exitCode).toBe(1);
  expect(stored(ws)[0]?.resolution).toBeNull();
  const mismatch = invoke(
    ws,
    [scopedThreadPass(true, BOT + 1)],
    scopedPolicy({
      findingSources: findingSources({
        sources: [findingSource({ accountId: BOT + 1, reviewer: HOSTED })],
      }),
    })
  );
  expect(mismatch.exitCode).toBe(1);
  expect(stored(ws)[0]?.resolution).toBeNull();
});

test("scoped non-thread Codex reports use one identity aligned with the attempt", () => {
  const ws = workspace();
  seedLedger(ws);
  const adverse = comment({
    has_any_findings: true,
    has_unresolved_findings: true,
  });
  const ran = invoke(ws, [
    findingPass({
      comments: sourceComments({
        ...adverse,
        body: String(adverse.body)
          .replace("private-code-review-body", "")
          .trim(),
      }),
    }),
  ]);
  expect(ran.exitCode).toBe(1);
  const entries = stored(ws);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "adverse-review",
    reportingSource: { accountId: BOT },
    reviewer: HOSTED,
  });
  const reviewGate = gate(ran, "agent-review");
  expect(reviewGate.codes).toContain("blocking-findings");
  expect(reviewGate.codes).not.toContain("missing-finding");
});

test("a reobserved legacy Codex summary keeps its exact origin and attempt linkage", () => {
  const ws = workspace();
  seedLedger(ws);
  const adverse = comment({
    has_any_findings: true,
    has_unresolved_findings: true,
  });
  const legacy = run(
    ws,
    gateArgs(ws, { policy: codexPolicy(), review: null }),
    {
      script: { passes: [codexPass({ comments: sourceComments(adverse) })] },
    }
  );
  expect(legacy.exitCode).toBe(1);
  const [original] = stored(ws);
  if (original === undefined) {
    throw new Error("legacy summary fixture did not retain a finding");
  }
  const repeated = invoke(ws, [
    findingPass({ comments: sourceComments(adverse) }),
  ]);
  expect(repeated.exitCode).toBe(1);
  expect(stored(ws)).toHaveLength(1);
  expect(stored(ws)[0]).toEqual(original);
  const { facts } = evaluated(repeated).evaluation.input;
  if (facts.schemaVersion !== 2 || facts.event !== "pull_request") {
    throw new Error("expected scoped pull-request evaluation");
  }
  expect(facts.pullRequest.agentReviews[0]?.findingIds).toContain(original.id);
  expect(
    facts.pullRequest.reviewFindings.coverage?.legacySources
  ).toContainEqual({
    ...origin(original),
    reportingSource: { accountId: BOT, actorType: "Bot" },
  });
});
