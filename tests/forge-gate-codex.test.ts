import { afterEach, expect, setDefaultTimeout, test } from "bun:test";

import { HOSTED, policyV2 } from "./agent-review-fixtures.ts";
import { BASE, HEAD } from "./evidence-fixtures.ts";
import {
  adoption,
  BODY_MARKER,
  codexPass,
  codexPolicy,
  comment,
  comments,
  thread,
  threads,
} from "./gate-codex-fixtures.ts";
import { cleanReview, pullRequest, SERVED } from "./gate-fixtures.ts";
import {
  cleanupGateWorkspace,
  evaluated,
  gate,
  gateArgs,
  issues,
  ledgerText,
  notCollected,
  run,
  RUN_ID,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";
import type { Ran } from "./gate-test-harness.ts";

setDefaultTimeout(30_000);
afterEach(cleanupGateWorkspace);

const facts = (ran: Ran) => {
  const input = evaluated(ran).evaluation.input.facts;
  if (input.event !== "pull_request" || input.schemaVersion !== 2) {
    throw new Error("wrong gate fixture facts");
  }
  return input.pullRequest;
};

test("normal CLI collects a complete clean review without an external evidence file", () => {
  const ws = workspace();
  seedLedger(ws);
  const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: { passes: [codexPass()] },
  });
  expect(ran.exitCode).toBe(0);
  expect(facts(ran).agentReviews).toHaveLength(1);
  expect(facts(ran).agentReviews[0]).toMatchObject({
    context: "none",
    provenance: { runId: RUN_ID },
    reviewer: HOSTED,
    state: "completed",
    verdict: "passed",
  });
  expect(facts(ran).reviewFindings).toEqual({ findings: [], recorded: true });
  expect(evaluated(ran).codexReview?.observations.attestation).toMatchObject({
    id: "fixture-independence",
    policyRevision: "f".repeat(40),
    repository: "example/project",
    reviewer: HOSTED,
  });
  expect(JSON.parse(ledgerText(ws)).reviewFindings).toEqual({
    findings: [],
    recorded: true,
  });
  expect(ran.stdout).not.toContain(BODY_MARKER);
  expect(ran.stdout).not.toContain("codex-review-state:v1");
  const reads = ran.requests.map((request) => {
    if (request.body !== null) {
      const query = JSON.parse(request.body).query as string;
      return query.includes("reviewThreads(") ? "threads" : "comments";
    }
    return new URL(request.url).pathname.split("/").at(-1);
  });
  expect(reads).toEqual([
    "reviews",
    "comments",
    "12",
    "timeline",
    "threads",
    "12",
    "reviews",
    "timeline",
    "threads",
    "comments",
  ]);
});

test("explicitly supplied unknown history remains a blocker alongside a clean collector result", () => {
  const ws = workspace();
  seedLedger(ws);
  const review = {
    agentReviews: [],
    reviewFindings: { findings: [], recorded: false },
    reviewLadder: null,
  };
  const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review }), {
    script: { passes: [codexPass()] },
  });
  expect(ran.exitCode).toBe(1);
  expect(gate(ran, "agent-review").codes).toContain("findings-unknown");
  expect(JSON.parse(ledgerText(ws)).reviewFindings.recorded).toBe(true);
});

test("null attestation leaves completed hosted evidence unqualified for independence", () => {
  const ws = workspace();
  seedLedger(ws);
  const ran = run(
    ws,
    gateArgs(ws, {
      policy: codexPolicy({ codexReview: adoption({ independence: null }) }),
      review: null,
    }),
    { script: { passes: [codexPass()] } }
  );
  expect(ran.exitCode).toBe(1);
  expect(facts(ran).agentReviews[0]?.context).toBe("unknown");
  expect(gate(ran, "agent-review").codes).toContain("review-not-independent");
  expect(evaluated(ran).codexReview?.observations.attestation).toBeNull();
});

test.each([
  {
    name: "stale head",
    response: codexPass({
      comments: { body: comments(comment({ commit_sha: "c".repeat(40) })) },
    }),
  },
  {
    name: "base away and back",
    response: codexPass({
      timeline: {
        body: [
          { created_at: "2024-01-01T00:01:00Z", event: "base_ref_changed" },
          { created_at: "2024-01-01T00:02:00Z", event: "base_ref_changed" },
        ],
      },
    }),
  },
])("$name cannot qualify a current completed review", ({ response }) => {
  const ws = workspace();
  seedLedger(ws);
  const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: { passes: [response] },
  });
  expect(ran.exitCode).toBe(1);
  expect(facts(ran).agentReviews[0]?.state).not.toBe("completed");
  expect(gate(ran, "agent-review").codes).toContain("review-unavailable");
});

test("a first snapshot is stored but cannot qualify an older summary", () => {
  const ws = workspace();
  const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: { passes: [codexPass()] },
  });
  expect(ran.exitCode).toBe(1);
  expect(evaluated(ran).codexReview?.diagnostics).toContain("summary-unbound");
  expect(JSON.parse(ledgerText(ws)).observedRevision.observedAt).toBe(
    "2024-01-01T01:00:00Z"
  );
});

test("adverse findings persist into a later clean run and reopen after native resolution", () => {
  const ws = workspace();
  seedLedger(ws);
  const args = gateArgs(ws, { policy: codexPolicy(), review: null });
  const adverse = codexPass({
    comments: {
      body: comments(
        comment({ has_any_findings: true, has_unresolved_findings: true })
      ),
    },
    threads: { body: threads(thread()) },
  });
  const first = run(ws, args, { script: { passes: [adverse] } });
  expect(first.exitCode).toBe(1);
  expect(facts(first).agentReviews[0]).toMatchObject({
    state: "completed",
    verdict: "failed",
  });
  const [original] = JSON.parse(ledgerText(ws)).reviewFindings.findings;
  expect(original).toMatchObject({
    id: "T1",
    kind: "finding",
    resolution: null,
  });
  const missing = run(ws, args, { script: { passes: [codexPass()] } });
  expect(gate(missing, "agent-review").codes).toContain("blocking-findings");
  expect(JSON.parse(ledgerText(ws)).reviewFindings.findings[0]).toEqual(
    original
  );
  const resolved = run(ws, args, {
    script: {
      passes: [codexPass({ threads: { body: threads(thread(true)) } })],
    },
  });
  expect(resolved.exitCode).toBe(0);
  expect(
    JSON.parse(ledgerText(ws)).reviewFindings.findings[0].resolution.kind
  ).toBe("native");
  const reopened = run(ws, args, {
    script: { passes: [codexPass({ threads: { body: threads(thread()) } })] },
  });
  expect(gate(reopened, "agent-review").codes).toContain("blocking-findings");
  expect(
    JSON.parse(ledgerText(ws)).reviewFindings.findings[0].resolution
  ).toBeNull();
});

test("disappeared previously native-resolved thread restores the persisted blocker", () => {
  const ws = workspace();
  seedLedger(ws);
  const args = gateArgs(ws, { policy: codexPolicy(), review: null });
  expect(
    run(ws, args, {
      script: {
        passes: [codexPass({ threads: { body: threads(thread(true)) } })],
      },
    }).exitCode
  ).toBe(0);
  const next = run(ws, args, { script: { passes: [codexPass()] } });
  expect(gate(next, "agent-review").codes).toContain("blocking-findings");
  expect(
    JSON.parse(ledgerText(ws)).reviewFindings.findings[0].resolution
  ).toBeNull();
});

test("detail-less adverse summary persists even when a later summary and external review are clean", () => {
  const ws = workspace();
  seedLedger(ws);
  const first = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: {
      passes: [
        codexPass({
          comments: { body: comments(comment({ has_any_findings: true })) },
        }),
      ],
    },
  });
  expect(facts(first).reviewFindings.findings[0]?.kind).toBe("adverse-review");
  const next = run(
    ws,
    gateArgs(ws, { policy: codexPolicy(), review: cleanReview() }),
    { script: { passes: [codexPass()] } }
  );
  expect(gate(next, "agent-review").codes).toContain("blocking-findings");
});

test.each(
  [null, "invalid attempts", [null]].map((agentReviews) => ({ agentReviews }))
)(
  "malformed supplied attempts cannot be hidden by collector evidence",
  ({ agentReviews }) => {
    const ws = workspace();
    seedLedger(ws);
    const review = {
      agentReviews,
      reviewFindings: { findings: [], recorded: true },
      reviewLadder: null,
    };
    const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review }), {
      script: { passes: [codexPass()] },
    });
    expect(ran.exitCode).toBe(2);
    expect(issues(ran)[0]?.path).toContain("facts.pullRequest.agentReviews");
  }
);

test("a duplicate supplied attempt remains blocking duplicate evidence", () => {
  const ws = workspace();
  seedLedger(ws);
  const first = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: { passes: [codexPass()] },
  });
  const review = {
    agentReviews: facts(first).agentReviews,
    reviewFindings: { findings: [], recorded: true },
    reviewLadder: null,
  };
  const duplicate = run(ws, gateArgs(ws, { policy: codexPolicy(), review }), {
    script: { passes: [codexPass()] },
  });
  expect(duplicate.exitCode).toBe(1);
  expect(gate(duplicate, "agent-review").codes).toContain("duplicate-evidence");
});

test("malformed supplied finding history retains invalid-input", () => {
  const ws = workspace();
  seedLedger(ws);
  const ran = run(
    ws,
    gateArgs(ws, {
      policy: codexPolicy(),
      review: { agentReviews: [], reviewFindings: null, reviewLadder: null },
    }),
    { script: { passes: [codexPass()] } }
  );
  expect(ran.exitCode).toBe(2);
  expect(issues(ran)[0]?.path).toBe("facts.pullRequest.reviewFindings");
});

test("comment read failures retain transport status and produce no ledger update", () => {
  const ws = workspace();
  const before = seedLedger(ws);
  const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: {
      passes: [
        codexPass({
          comments: { body: { message: BODY_MARKER }, status: 503 },
        }),
      ],
    },
  });
  expect(ran.exitCode).toBe(3);
  expect(notCollected(ran)).toMatchObject({
    collection: { reason: "read-failed", status: "unavailable" },
    read: { code: "request-failed", status: 503 },
    stage: "collection",
  });
  expect(ledgerText(ws)).toBe(before);
  expect(ran.stdout).not.toContain(BODY_MARKER);
});

test("changing comments prevents both ledger storage and evaluation", () => {
  const ws = workspace();
  const before = seedLedger(ws);
  const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: {
      passes: [
        codexPass(),
        codexPass({
          comments: { body: comments(comment({}, { editor: null })) },
        }),
      ],
    },
  });
  expect(notCollected(ran)).toMatchObject({
    collection: { reason: "comments-changed", status: "changed" },
    stage: "collection",
  });
  expect(ledgerText(ws)).toBe(before);
});

test("a findings CAS conflict discards collected evidence and source metadata", () => {
  const ws = workspace();
  seedLedger(ws);
  const other = JSON.stringify({
    observedRevision: {
      baseSha: BASE,
      headSha: HEAD,
      observedAt: "2024-01-01T00:01:00Z",
    },
    requiredReviewers: [],
    reviewBindings: {},
    reviewFindings: { findings: [], recorded: true },
  });
  const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: {
      interference: { file: ws.ledgerFile, text: other },
      passes: [codexPass()],
    },
  });
  expect(notCollected(ran)).toMatchObject({
    code: "conflict",
    stage: "ledger-store",
  });
  expect(ran.document).not.toHaveProperty("codexReview");
  expect(ledgerText(ws)).toBe(other);
});

test.each([
  adoption({ reviewer: "unknown" }),
  adoption({ reviewer: "local-cli" }),
  adoption({
    independence: {
      id: "fixture",
      policyRevision: "revision",
      statement: "unapproved statement",
    },
  }),
])("invalid adopted configuration stops before requests", (codexReview) => {
  const ws = workspace();
  const ran = run(
    ws,
    gateArgs(ws, { policy: codexPolicy({ codexReview }), review: null }),
    { script: { passes: [codexPass()] } }
  );
  expect(ran.exitCode).toBe(2);
  expect(ran.requests).toEqual([]);
});

test("duplicate configured hosted reviewers fail before requests", () => {
  const ws = workspace();
  const evidence = policyV2();
  evidence.agentReview.reviewers.push({
    producer: "hosted-collector:fixture",
    reviewer: HOSTED,
    rung: "hosted",
    runtimeFingerprint: "6".repeat(64),
    waitSeconds: 900,
  });
  const ran = run(
    ws,
    gateArgs(ws, { policy: codexPolicy({ evidence }), review: null }),
    { script: { passes: [codexPass()] } }
  );
  expect(ran.exitCode).toBe(2);
  expect(ran.requests).toEqual([]);
});

test("a changed pull request head cannot reuse the prior summary or snapshot", () => {
  const ws = workspace();
  seedLedger(ws);
  const changed = "d".repeat(40);
  const response = codexPass({
    pullRequest: {
      body: pullRequest({
        head: { ref: "feature", repo: { id: 100 }, sha: changed },
      }),
      date: SERVED,
    },
  });
  const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: { passes: [response] },
  });
  expect(facts(ran).subject.headSha).toBe(changed);
  expect(facts(ran).agentReviews[0]?.state).toBe("pending");
  expect(
    evaluated(ran).codexReview?.observations.summary.state?.codeReview.commitSha
  ).toBe(HEAD);
  expect(gate(ran, "agent-review").codes).toContain("review-pending");
});
