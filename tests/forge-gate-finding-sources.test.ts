import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";

import {
  actor,
  cleanComment,
  connection,
  findingPass,
  findingSource,
  findingSources,
  invoke,
  OTHER_REPORTER,
  report,
  reportingThread,
  REPORTER,
  scopedPolicy,
  sourceComments,
  TIME,
} from "./finding-sources-gate-fixtures.ts";
import {
  adoption,
  codexPolicy,
  comment,
  comments,
} from "./gate-codex-fixtures.ts";
import { cleanReview, pullRequest } from "./gate-fixtures.ts";
import {
  cleanupGateWorkspace,
  evaluated,
  gate,
  gateArgs,
  issues,
  ledgerText,
  run,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";
import type { Ran } from "./gate-test-harness.ts";
import { issueCommentResponse } from "./github-fixtures.ts";

setDefaultTimeout(30_000);
afterEach(cleanupGateWorkspace);
const findings = (ran: Ran) => {
  const { facts } = evaluated(ran).evaluation.input;
  if (facts.event !== "pull_request" || facts.schemaVersion !== 2) {
    throw new Error("expected version-two pull request facts");
  }
  return facts.pullRequest.reviewFindings;
};
const storedFindings = (ws: ReturnType<typeof workspace>) =>
  JSON.parse(ledgerText(ws)).reviewFindings;
const threadPass = (overrides: Record<string, unknown> = {}) =>
  findingPass({
    findingThreads: {
      body: connection("reviewThreads", [reportingThread(overrides)]),
    },
  });

test("real CLI collects scoped complete coverage and independent review without a supplied file", () => {
  const ws = workspace();
  seedLedger(ws);
  const ran = invoke(ws);
  expect(ran.exitCode).toBe(0);
  expect(findings(ran)).toMatchObject({ findings: [], recorded: true });
  expect(storedFindings(ws)).toEqual(findings(ran));
  expect(
    ran.requests.some((request) =>
      request.body?.includes("ForgeFindingReviews")
    )
  ).toBe(true);
  expect(
    ran.requests.some((request) =>
      request.body?.includes("ForgeFindingThreads")
    )
  ).toBe(true);
});

test("native open, resolved, reopened, outdated and disappeared findings survive separate CLI runs", () => {
  const ws = workspace();
  seedLedger(ws);
  const opened = invoke(ws, [threadPass()]);
  expect(opened.exitCode).toBe(1);
  expect(gate(opened, "agent-review").codes).toContain("blocking-findings");
  const [original] = storedFindings(ws).findings;
  expect(original).toMatchObject({
    id: "FINDING_THREAD_1",
    resolution: null,
    reviewer: "reporting-bot",
  });
  const resolved = invoke(ws, [
    threadPass({ isOutdated: true, isResolved: true }),
  ]);
  expect(resolved.exitCode).toBe(0);
  expect(storedFindings(ws).findings[0]).toMatchObject({
    ...original,
    resolution: { kind: "configured-native", nativeRef: "FINDING_THREAD_1" },
  });
  const missing = invoke(ws);
  expect(missing.exitCode).toBe(1);
  expect(storedFindings(ws).findings[0]).toMatchObject(original);
  const reopened = invoke(ws, [threadPass({ isOutdated: true })]);
  expect(gate(reopened, "agent-review").codes).toContain("blocking-findings");
  expect(storedFindings(ws).findings[0]).toMatchObject(original);
});

test("renaming a reporter preserves native identity while removing its source restores its blocker", () => {
  const ws = workspace();
  seedLedger(ws);
  const renamed = threadPass({
    comments: {
      nodes: [report({ author: actor(REPORTER, "renamed-bot[bot]") })],
      pageInfo: { endCursor: null, hasNextPage: false },
    },
    isResolved: true,
  });
  expect(invoke(ws, [renamed]).exitCode).toBe(0);
  const current = findingSources();
  const removed = scopedPolicy({
    findingSources: { ...current, sources: current.sources.slice(0, 1) },
  });
  const ran = invoke(ws, [findingPass()], removed);
  expect(gate(ran, "agent-review").codes).toContain("blocking-findings");
  expect(storedFindings(ws).findings).toHaveLength(1);
});

test.each([
  [
    "unfamiliar bot",
    issueCommentResponse({ author: actor(OTHER_REPORTER), editor: null }),
  ],
  [
    "unknown prose",
    issueCommentResponse({
      author: actor(),
      body: "Maybe fine, perhaps findings elsewhere.",
      editor: null,
    }),
  ],
  ["deleted author", issueCommentResponse({ author: null, editor: null })],
  [
    "unverified editor",
    issueCommentResponse({
      author: actor(),
      editor: actor(OTHER_REPORTER),
      lastEditedAt: TIME,
    }),
  ],
])(
  "%s leaves coverage unknown beside a clean independent review",
  (_name, source) => {
    const ws = workspace();
    seedLedger(ws);
    const ran = invoke(ws, [
      findingPass({
        comments: sourceComments(cleanComment(), {
          ...source,
          databaseId: 700,
          id: "IC_700",
          url: "https://github.com/example/project/pull/12#issuecomment-700",
        }),
      }),
    ]);
    expect(ran.exitCode).toBe(1);
    expect(findings(ran).recorded).toBe(false);
    expect(gate(ran, "agent-review").codes).toContain("findings-unknown");
  }
);

test("an external surface without qualification cannot borrow historical complete coverage", () => {
  const ws = workspace();
  seedLedger(ws);
  expect(invoke(ws).exitCode).toBe(0);
  const policy = scopedPolicy({
    findingSources: findingSources({
      sources: [
        findingSource({ externalCoverage: "unknown", qualificationRef: null }),
      ],
    }),
  });
  const ran = invoke(ws, [findingPass()], policy);
  expect(findings(ran).recorded).toBe(false);
  expect(gate(ran, "agent-review").codes).toContain("findings-unknown");
});

test("configured source completeness never supplies the missing independent review", () => {
  const ws = workspace();
  seedLedger(ws);
  const ran = invoke(ws, [findingPass({ comments: { body: comments() } })]);
  expect(findings(ran).recorded).toBe(true);
  expect(ran.exitCode).toBe(1);
  expect(gate(ran, "agent-review").codes).toContain("review-unavailable");
});

test("scoped mode rejects copied supplied clean attempts before authenticated reads or ledger changes", () => {
  const ws = workspace();
  const original = seedLedger(ws);
  const ran = run(
    ws,
    gateArgs(ws, { policy: scopedPolicy(), review: cleanReview() }),
    {
      preloads: [
        path.join(import.meta.dir, "finding-sources-fetch-preload.ts"),
      ],
      script: { passes: [findingPass()] },
    }
  );
  expect(ran.exitCode).toBe(2);
  expect(issues(ran).length).toBeGreaterThan(0);
  expect(ran.requests).toHaveLength(0);
  expect(ledgerText(ws)).toBe(original);
});

test("a competing ledger replacement refuses the complete result without evaluating", () => {
  const ws = workspace();
  seedLedger(ws);
  const concurrent = JSON.parse(ledgerText(ws));
  concurrent.observedRevision.observedAt = "2024-01-01T00:00:01Z";
  const replacement = JSON.stringify(concurrent);
  const ran = run(ws, gateArgs(ws, { policy: scopedPolicy(), review: null }), {
    preloads: [path.join(import.meta.dir, "finding-sources-fetch-preload.ts")],
    script: {
      interference: { file: ws.ledgerFile, text: replacement },
      passes: [findingPass()],
    },
  });
  expect(ran.exitCode).toBe(3);
  expect(ran.document).toMatchObject({
    code: "conflict",
    stage: "ledger-store",
    status: "not-collected",
  });
  expect(ledgerText(ws)).toBe(replacement);
});

test.each(["review", "issue-comment"] as const)(
  "a %s-only adverse report persists after edit and deletion beside later clean output",
  (surface) => {
    const ws = workspace();
    seedLedger(ws);
    const firstReport = report({
      body:
        surface === "review"
          ? "**Devin Review** found 1 potential issues."
          : String(
              comment({ has_any_findings: true, has_unresolved_findings: true })
                .body
            ),
      state: "COMMENTED",
    });
    const observation =
      surface === "review"
        ? findingPass({
            findingReviews: { body: connection("reviews", [firstReport]) },
          })
        : findingPass({
            comments: sourceComments(
              cleanComment(),
              issueCommentResponse({ ...firstReport, databaseId: 700 })
            ),
          });
    const first = invoke(ws, [observation]);
    expect(gate(first, "agent-review").codes).toContain("blocking-findings");
    const adverse = storedFindings(ws).findings.find(
      (finding: { kind: string }) => finding.kind === "adverse-review"
    );
    expect(adverse).toMatchObject({
      resolution: null,
      reviewer: "reporting-bot",
    });
    const edited = {
      ...firstReport,
      body: "**Devin Review** found 0 potential issues.",
      editor: actor(),
      lastEditedAt: "2024-01-01T00:40:00Z",
      updatedAt: "2024-01-01T00:40:00Z",
    };
    const cleanObservation =
      surface === "review"
        ? findingPass({
            findingReviews: { body: connection("reviews", [edited]) },
          })
        : findingPass({
            comments: sourceComments(
              cleanComment(),
              issueCommentResponse({ ...edited, databaseId: 700 })
            ),
          });
    expect(
      gate(invoke(ws, [cleanObservation]), "agent-review").codes
    ).toContain("blocking-findings");
    expect(gate(invoke(ws), "agent-review").codes).toContain(
      "blocking-findings"
    );
    expect(storedFindings(ws).findings).toContainEqual(adverse);
  }
);

test("changing valid observations retain adverse evidence while completeness stays unknown", () => {
  const ws = workspace();
  seedLedger(ws);
  const first = threadPass();
  const second = findingPass();
  const ran = invoke(ws, [first, second]);
  expect(ran.exitCode).toBe(1);
  expect(findings(ran).recorded).toBe(false);
  expect(gate(ran, "agent-review").codes).toContain("findings-unknown");
  expect(storedFindings(ws).findings).toContainEqual(
    expect.objectContaining({ id: "FINDING_THREAD_1", resolution: null })
  );
});

test("new head and base preserve the original adverse entry", () => {
  const ws = workspace();
  seedLedger(ws);
  invoke(ws, [threadPass()]);
  const [original] = storedFindings(ws).findings;
  const changed = findingPass({
    pullRequest: {
      body: pullRequest({
        base: {
          ref: "main",
          repo: { full_name: "example/project", id: 100 },
          sha: "f".repeat(40),
        },
        head: { ref: "feature", repo: { id: 100 }, sha: "e".repeat(40) },
      }),
      date: "Mon, 01 Jan 2024 02:00:00 GMT",
    },
  });
  const ran = invoke(ws, [changed]);
  expect(ran.exitCode).toBe(1);
  expect(gate(ran, "agent-review").codes).toContain("blocking-findings");
  expect(storedFindings(ws).findings).toContainEqual(original);
});

test("scoped completeness cannot become global completeness after switching back to the legacy policy", () => {
  const ws = workspace();
  seedLedger(ws);
  expect(invoke(ws).exitCode).toBe(0);
  const legacy = run(
    ws,
    gateArgs(ws, {
      policy: codexPolicy({
        codexReview: adoption({ findingHistory: "supplied-global-ledger" }),
      }),
      review: null,
    }),
    { script: { passes: [findingPass()] } }
  );
  expect(legacy.exitCode).toBe(1);
  expect(gate(legacy, "agent-review").codes).toContain("findings-unknown");
  expect(storedFindings(ws).recorded).toBe(false);
});

test("a recognized quota notice permits coverage while another provider supplies the independent review", () => {
  const ws = workspace();
  seedLedger(ws);
  const quota = issueCommentResponse({
    author: actor(),
    body: "<h3>Bugbot couldn't run - usage limit reached</h3>\n\nBugbot is counted against Cursor usage for this user or team, and this run hit a usage or spend limit.\n\nA user or team admin can review and increase usage limits in the [Cursor dashboard](https://www.cursor.com/dashboard/spending).\n\n(requestId: 12345678-1234-1234-1234-123456789abc)",
    databaseId: 700,
    editor: null,
    id: "IC_700",
    lastEditedAt: null,
  });
  const ran = invoke(ws, [
    findingPass({ comments: sourceComments(cleanComment(), quota) }),
  ]);
  expect(ran.exitCode).toBe(0);
  expect(findings(ran).recorded).toBe(true);
  const withoutClean = invoke(ws, [
    findingPass({ comments: sourceComments(quota) }),
  ]);
  expect(withoutClean.exitCode).toBe(1);
  expect(findings(withoutClean).recorded).toBe(true);
  expect(gate(withoutClean, "agent-review").codes).toContain(
    "review-unavailable"
  );
});

test("a clean review for an earlier head cannot satisfy the current scoped gate", () => {
  const ws = workspace();
  seedLedger(ws);
  const old = comment({ commit_sha: "e".repeat(40) });
  const ran = invoke(ws, [
    findingPass({
      comments: sourceComments({
        ...old,
        body: String(old.body).replace("private-code-review-body", "").trim(),
      }),
    }),
  ]);
  expect(ran.exitCode).toBe(1);
  expect(findings(ran).recorded).toBe(true);
  expect(gate(ran, "agent-review").codes).toContain("review-unavailable");
});

test.each([
  {
    findingReviews: {
      body: { private: "private-provider-error" },
      status: 503,
    },
    name: "failed source read",
  },
  {
    findingReviews: {
      body: connection("reviews", [
        report({ author: null, state: "CHANGES_REQUESTED" }),
        report({ author: null, state: "CHANGES_REQUESTED" }),
      ]),
    },
    name: "duplicate page identities",
  },
])(
  "$name leaves the accepted ledger intact and never evaluates a partial observation",
  ({ findingReviews }) => {
    const ws = workspace();
    seedLedger(ws);
    expect(invoke(ws).exitCode).toBe(0);
    const before = ledgerText(ws);
    const ran = invoke(ws, [findingPass({ findingReviews })]);
    expect(ran.exitCode).toBe(3);
    expect(ran.document).toMatchObject({
      stage: "collection",
      status: "not-collected",
    });
    expect(ran.document).not.toHaveProperty("evaluation");
    expect(ran.stdout).not.toContain("private-provider-error");
    expect(ledgerText(ws)).toBe(before);
  }
);
