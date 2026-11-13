import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";

import {
  finding,
  nativeResolution,
  policyV2,
} from "./agent-review-fixtures.ts";
import { BASE, HEAD } from "./evidence-fixtures.ts";
import {
  adoption,
  codexPass,
  codexPolicy,
  thread,
  threads,
} from "./gate-codex-fixtures.ts";
import {
  cleanupGateWorkspace,
  evaluated,
  issues,
  notCollected,
  gate,
  gateArgs,
  ledgerText,
  run,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";

setDefaultTimeout(30_000);
afterEach(cleanupGateWorkspace);

test("an accepted external finding cannot vanish when its file is omitted on the next run", () => {
  const ws = workspace();
  seedLedger(ws);
  const reported = finding();
  const review = {
    agentReviews: [],
    reviewFindings: { findings: [reported], recorded: true },
    reviewLadder: null,
  };
  const first = run(ws, gateArgs(ws, { policy: codexPolicy(), review }), {
    script: { passes: [codexPass()] },
  });
  expect(gate(first, "agent-review").codes).toContain("blocking-findings");
  const second = run(
    ws,
    gateArgs(ws, { policy: codexPolicy(), review: null }),
    { script: { passes: [codexPass()] } }
  );
  expect(second.exitCode).toBe(1);
  expect(gate(second, "agent-review").codes).toContain("blocking-findings");
  expect(JSON.parse(ledgerText(ws)).reviewFindings.findings).toEqual([
    reported,
  ]);
});

const facts = (ran: ReturnType<typeof run>) => {
  const input = evaluated(ran).evaluation.input.facts;
  if (input.event !== "pull_request" || input.schemaVersion !== 2) {
    throw new Error("wrong fixture facts");
  }
  return input.pullRequest;
};
const history = (findings: unknown[], recorded = true) => ({
  agentReviews: [],
  reviewFindings: { findings, recorded },
  reviewLadder: null,
});
const otherPolicy = () => {
  const evidence = policyV2();
  evidence.agentReview.reviewers.push({
    producer: "other-collector",
    reviewer: "other-hosted",
    rung: "hosted",
    runtimeFingerprint: "8".repeat(64),
    waitSeconds: 30,
  });
  return codexPolicy({ evidence });
};
const resolvedFinding = () =>
  finding({
    resolution: nativeResolution({
      provenance: {
        producer: "other-collector",
        runId: "prior-resolution",
        runtimeFingerprint: "8".repeat(64),
      },
    }),
    reviewer: "other-hosted",
  });
const seedHistory = (ws: ReturnType<typeof workspace>, entries: unknown[]) => {
  seedLedger(ws);
  const entry = JSON.parse(ledgerText(ws));
  writeFileSync(
    ws.ledgerFile,
    JSON.stringify({
      ...entry,
      reviewFindings: { findings: entries, recorded: true },
    })
  );
};

test.each(["reopened", "changed origin"])(
  "an external %s finding stays blocked after file omission",
  (conflict) => {
    const ws = workspace();
    const original = resolvedFinding();
    seedHistory(ws, [original]);
    const policy = otherPolicy();
    const baseline = run(ws, gateArgs(ws, { policy, review: null }), {
      script: { passes: [codexPass()] },
    });
    expect(baseline.exitCode).toBe(0);
    expect(facts(baseline).agentReviews).toHaveLength(1);
    const incoming =
      conflict === "reopened"
        ? { ...original, resolution: null }
        : {
            ...original,
            attemptId: "changed-origin",
            nativeRef: "fixture://changed-origin",
          };
    const first = run(
      ws,
      gateArgs(ws, { policy, review: history([incoming]) }),
      { script: { passes: [codexPass()] } }
    );
    expect(gate(first, "agent-review").codes).toContain("blocking-findings");
    expect(JSON.parse(ledgerText(ws)).reviewFindings.findings).toEqual([
      { ...original, resolution: null },
    ]);
    const second = run(ws, gateArgs(ws, { policy, review: null }), {
      script: { passes: [codexPass()] },
    });
    expect(second.exitCode).toBe(1);
    expect(gate(second, "agent-review").codes).toContain("blocking-findings");
    expect(JSON.parse(ledgerText(ws)).reviewFindings.findings).toEqual([
      { ...original, resolution: null },
    ]);
  }
);

test("an external resolution cannot clear a previously accepted unresolved finding", () => {
  const ws = workspace();
  const resolved = resolvedFinding();
  const original = { ...resolved, resolution: null };
  seedHistory(ws, [original]);
  const policy = otherPolicy();
  const first = run(ws, gateArgs(ws, { policy, review: history([resolved]) }), {
    script: { passes: [codexPass()] },
  });
  expect(first.exitCode).toBe(1);
  expect(gate(first, "agent-review").codes).toContain("blocking-findings");
  expect(JSON.parse(ledgerText(ws)).reviewFindings.findings).toEqual([
    original,
  ]);
  const second = run(ws, gateArgs(ws, { policy, review: null }), {
    script: { passes: [codexPass()] },
  });
  expect(gate(second, "agent-review").codes).toContain("blocking-findings");
});

test("new accepted entries retain typed resolutions and exact repeated entries deduplicate", () => {
  const ws = workspace();
  seedLedger(ws);
  const reported = resolvedFinding();
  const policy = otherPolicy();
  const first = run(ws, gateArgs(ws, { policy, review: history([reported]) }), {
    script: { passes: [codexPass()] },
  });
  expect(first.exitCode).toBe(0);
  expect(JSON.parse(ledgerText(ws)).reviewFindings.findings).toEqual([
    reported,
  ]);
  const repeated = run(
    ws,
    gateArgs(ws, { policy, review: history([reported]) }),
    { script: { passes: [codexPass()] } }
  );
  expect(repeated.exitCode).toBe(0);
  expect(facts(repeated).reviewFindings.findings).toEqual([reported]);
});

test.each([
  { complete: false, name: "missing", review: null },
  { complete: false, name: "unknown", review: history([], false) },
  { complete: true, name: "complete", review: history([]) },
])(
  "supplied-global-ledger coverage requires current $name history",
  ({ complete, review }) => {
    const ws = workspace();
    seedLedger(ws);
    const policy = codexPolicy({
      codexReview: adoption({ findingHistory: "supplied-global-ledger" }),
    });
    const ran = run(ws, gateArgs(ws, { policy, review }), {
      script: { passes: [codexPass()] },
    });
    expect(ran.exitCode).toBe(complete ? 0 : 1);
    expect(facts(ran).reviewFindings.recorded).toBe(complete);
    expect(JSON.parse(ledgerText(ws)).reviewFindings.recorded).toBe(complete);
    expect(evaluated(ran).codexReview?.findingHistory).toBe(
      "supplied-global-ledger"
    );
    if (!complete) {
      expect(gate(ran, "agent-review").codes).toContain("findings-unknown");
    }
  }
);

test("codex-only ownership accepts explicit empty supplied history without other reviewer attempts", () => {
  const ws = workspace();
  seedLedger(ws);
  const ran = run(
    ws,
    gateArgs(ws, { policy: codexPolicy(), review: history([]) }),
    { script: { passes: [codexPass()] } }
  );
  expect(ran.exitCode).toBe(0);
  expect(facts(ran).agentReviews).toHaveLength(1);
  expect(evaluated(ran).codexReview?.findingHistory).toBe("codex-only");
});

test("malformed supplied findings remain invalid input and are not ingested", () => {
  const ws = workspace();
  seedLedger(ws);
  const marker = "private-malformed-finding";
  const malformed = {
    ...finding(),
    resolution: { kind: "native", nativeRef: marker, provenance: marker },
  };
  const ran = run(
    ws,
    gateArgs(ws, { policy: codexPolicy(), review: history([malformed]) }),
    { script: { passes: [codexPass()] } }
  );
  expect(ran.exitCode).toBe(2);
  expect(issues(ran)[0]?.path).toContain("reviewFindings");
  expect(ran.stdout).not.toContain(marker);
  expect(JSON.parse(ledgerText(ws)).reviewFindings.findings).toEqual([]);
});

test("duplicate supplied history is non-passing and cannot attest global completeness or be ingested", () => {
  const ws = workspace();
  seedLedger(ws);
  const policy = codexPolicy({
    codexReview: adoption({ findingHistory: "supplied-global-ledger" }),
  });
  const ran = run(
    ws,
    gateArgs(ws, { policy, review: history([finding(), finding()]) }),
    { script: { passes: [codexPass()] } }
  );
  expect(ran.exitCode).toBe(1);
  expect(gate(ran, "agent-review").codes).toContain("duplicate-evidence");
  expect(JSON.parse(ledgerText(ws)).reviewFindings).toEqual({
    findings: [],
    recorded: false,
  });
});

test("a CAS conflict prevents accepted external findings from being published or evaluated", () => {
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
  const ran = run(
    ws,
    gateArgs(ws, { policy: codexPolicy(), review: history([finding()]) }),
    {
      script: {
        interference: { file: ws.ledgerFile, text: other },
        passes: [codexPass()],
      },
    }
  );
  expect(notCollected(ran)).toMatchObject({
    code: "conflict",
    stage: "ledger-store",
  });
  expect(ran.document).not.toHaveProperty("evaluation");
  expect(ledgerText(ws)).toBe(other);
});

test("unresolved threads from another author independently block landing", () => {
  const ws = workspace();
  seedLedger(ws);
  const foreign = {
    ...thread(),
    comments: {
      nodes: [
        { author: { __typename: "Bot", databaseId: 999, login: "other-bot" } },
      ],
    },
  };
  const ran = run(ws, gateArgs(ws, { policy: codexPolicy(), review: null }), {
    script: { passes: [codexPass({ threads: { body: threads(foreign) } })] },
  });
  expect(ran.exitCode).toBe(1);
  expect(gate(ran, "mergeability").paths).toContain(
    "facts.pullRequest.unresolvedThreads"
  );
});

test("a prior complete supplied-global-ledger cannot substitute for current source coverage", () => {
  const ws = workspace();
  seedLedger(ws);
  const policy = codexPolicy({
    codexReview: adoption({ findingHistory: "supplied-global-ledger" }),
  });
  const complete = run(ws, gateArgs(ws, { policy, review: history([]) }), {
    script: { passes: [codexPass()] },
  });
  expect(complete.exitCode).toBe(0);
  const missing = run(ws, gateArgs(ws, { policy, review: null }), {
    script: { passes: [codexPass()] },
  });
  expect(missing.exitCode).toBe(1);
  expect(gate(missing, "agent-review").codes).toContain("findings-unknown");
  expect(JSON.parse(ledgerText(ws)).reviewFindings.recorded).toBe(false);
});
