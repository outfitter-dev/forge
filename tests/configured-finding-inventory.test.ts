import { expect, test } from "bun:test";

import { classifyFindingReport } from "../src/configured-finding-classification.ts";
import { configuredFindingInventory } from "../src/configured-finding-inventory.ts";
import type { ConfiguredFindingInventoryInput } from "../src/configured-finding-inventory.ts";
import type { ReviewFindingLedger } from "../src/evidence-types.ts";
import { parseFindingSourcesPolicy } from "../src/finding-source-policy.ts";
import type {
  FindingObservation,
  FindingReport,
  FindingThread,
} from "../src/github-finding-observations.ts";
import { evaluateLedger } from "../src/review-finding-ledger.ts";
import { parseStoredFindings } from "../src/review-ledger-findings.ts";
import {
  localAttempt,
  passingPrV2,
  policyV2,
} from "./agent-review-fixtures.ts";
import { subject } from "./evidence-fixtures.ts";

const actor = { id: 123, login: "renamable-bot", type: "Bot" };
const sourcePolicy = (accountId = actor.id) =>
  parseFindingSourcesPolicy({
    policyRevision: "a".repeat(40),
    resolution: "github-native",
    sources: [
      {
        accountId,
        actorType: "Bot",
        externalCoverage: "qualified",
        formats: [
          "github-thread-v1",
          "codex-summary-v1",
          "devin-review-v1",
          "cursor-summary-v1",
          "linear-linkback-v1",
        ],
        qualificationRef: "fixture://reporter-qualification",
        reviewer: "reporter",
        surfaces: ["review", "issue-comment", "thread-comment"],
      },
    ],
    unqualifiedSources: [],
  });
const report = (overrides: Partial<FindingReport> = {}): FindingReport => ({
  author: actor,
  body: "",
  commitId: "b".repeat(40),
  editor: actor,
  id: "report-1",
  lastEditedAt: null,
  nativeRef: "fixture://report-1",
  nodeId: "report-1",
  state: "COMMENTED",
  surface: "review",
  updatedAt: "2026-01-01T00:20:00Z",
  ...overrides,
});
const thread = (overrides: Partial<FindingThread> = {}): FindingThread => ({
  comments: [
    report({ body: "An observed native finding", surface: "thread-comment" }),
  ],
  id: "thread-1",
  isOutdated: true,
  isResolved: false,
  ...overrides,
});
const observed = (
  overrides: Partial<FindingObservation> = {}
): FindingObservation => ({
  comments: [],
  reviews: [],
  threads: [],
  ...overrides,
});
const input = (
  observation = observed(),
  findings?: ReviewFindingLedger
): ConfiguredFindingInventoryInput => ({
  findings: findings ?? { findings: [], recorded: false },
  first: observation,
  issuer: passingPrV2().provenance,
  policy: sourcePolicy(),
  second: structuredClone(observation),
  subject: subject(),
});
const collected = (
  observation: FindingObservation,
  findings?: ReviewFindingLedger
) => configuredFindingInventory(input(observation, findings));
const authority = (args: ConfiguredFindingInventoryInput) => ({
  policyDigest: args.policy.policyDigest,
  policyRevision: args.policy.policyRevision,
  reviewers: args.policy.sources.map((source) => source.reviewer),
  sourceAccounts: args.policy.sources.map(
    ({ reviewer, accountId, actorType }) => ({ accountId, actorType, reviewer })
  ),
});

test("stable complete empty scope is recorded with immutable policy and source identity", () => {
  const result = collected(observed());
  expect(result.reviewFindings.recorded).toBe(true);
  expect(result.reviewFindings.coverage?.sourceAccounts).toEqual([
    { accountId: 123, actorType: "Bot", reviewer: "reporter" },
  ]);
  expect(parseStoredFindings(result.reviewFindings)).toEqual(
    result.reviewFindings
  );
});

test("outdated native finding is retained across head and base, resolved, reopened and missing", () => {
  const open = collected(observed({ threads: [thread()] })).reviewFindings;
  const old = structuredClone(open.findings[0]);
  const args = input(
    observed({ threads: [thread({ isResolved: true })] }),
    open
  );
  args.subject = {
    ...args.subject,
    baseSha: "f".repeat(40),
    headSha: "e".repeat(40),
  };
  const resolved = configuredFindingInventory(args).reviewFindings;
  expect(resolved.findings[0]).toMatchObject({
    ...old,
    resolution: { kind: "configured-native" },
  });
  const reopened = collected(
    observed({ threads: [thread()] }),
    resolved
  ).reviewFindings;
  expect(reopened.findings[0]?.resolution).toBeNull();
  expect(
    collected(observed(), resolved).reviewFindings.findings[0]?.resolution
  ).toBeNull();
  expect(reopened.findings[0]?.attemptId).toBe(old?.attemptId);
});

test("reopened or missing native thread clears any earlier follow-up clearance", () => {
  const ledger = collected(observed({ threads: [thread()] })).reviewFindings;
  const [finding] = ledger.findings;
  if (!finding) {
    throw new Error("missing finding");
  }
  finding.resolution = {
    attemptId: "independent-followup",
    disposition: "fixed",
    kind: "follow-up-review",
    nativeRef: "fixture://follow-up",
    provenance: passingPrV2().provenance,
    subject: subject(),
  };
  expect(
    collected(observed({ threads: [thread()] }), ledger).reviewFindings
      .findings[0]?.resolution
  ).toBeNull();
  expect(
    collected(observed(), ledger).reviewFindings.findings[0]?.resolution
  ).toBeNull();
});

test("reporter removal and alias reassignment preserve original source and cannot clear finding", () => {
  const ledger = collected(observed({ threads: [thread()] })).reviewFindings;
  const args = input(
    observed({
      threads: [
        thread({
          comments: [
            report({
              author: { ...actor, id: 456 },
              editor: { ...actor, id: 456 },
              surface: "thread-comment",
            }),
          ],
          isResolved: true,
        }),
      ],
    }),
    ledger
  );
  args.policy = sourcePolicy(456);
  const reassigned = configuredFindingInventory(args).reviewFindings;
  expect(reassigned.findings[0]?.reportingSource?.accountId).toBe(123);
  expect(reassigned.findings[0]?.resolution).toBeNull();
  const removed = input(observed(), ledger);
  removed.policy = parseFindingSourcesPolicy({
    ...sourcePolicy(456),
    policyDigest: sourcePolicy(456).policyDigest,
  });
  expect(
    configuredFindingInventory(removed).reviewFindings.findings[0]?.resolution
  ).toBeNull();
});

test("a different bot reply never claims ownership of a native thread", () => {
  const t = thread({
    comments: [
      report({
        author: { id: 999, login: "human", type: "User" },
        editor: null,
        surface: "thread-comment",
      }),
      report({ id: "reply", surface: "thread-comment" }),
    ],
    isResolved: true,
  });
  const result = collected(observed({ threads: [t] }));
  expect(result.reviewFindings.findings).toEqual([]);
  expect(result.coverage.diagnostics).toContain("thread-reply-format-unknown");
});

test("changed reads retain adverse claims from both passes but withhold native resolution", () => {
  const args = input(
    observed({
      reviews: [report({ state: "CHANGES_REQUESTED" })],
      threads: [thread({ isResolved: true })],
    })
  );
  args.second = observed({ reviews: [], threads: [thread()] });
  const result = configuredFindingInventory(args);
  expect(result.reviewFindings.recorded).toBe(false);
  expect(result.reviewFindings.findings.map((finding) => finding.kind)).toEqual(
    ["finding", "adverse-review"]
  );
  expect(
    result.reviewFindings.findings.every(
      (finding) => finding.resolution === null
    )
  ).toBe(true);
});

test("edited and deleted adverse reports survive a newer clean state", () => {
  const first = collected(
    observed({
      reviews: [
        report({
          body: "Unsupported but positively adverse",
          state: "CHANGES_REQUESTED",
        }),
      ],
    })
  ).reviewFindings;
  const edit = report({
    body: "New adverse details",
    state: "CHANGES_REQUESTED",
    updatedAt: "2026-01-01T00:21:00Z",
  });
  const second = collected(observed({ reviews: [edit] }), first).reviewFindings;
  expect(second.findings).toHaveLength(2);
  const deleted = collected(observed(), second).reviewFindings;
  expect(deleted.recorded).toBe(true);
  expect(deleted.findings).toEqual(second.findings);
});

test.each([null, { id: 999, login: "foreign", type: "Bot" }])(
  "missing or unfamiliar reporter %j leaves coverage unknown",
  (author) => {
    expect(
      collected(
        observed({ comments: [report({ author, surface: "issue-comment" })] })
      ).reviewFindings.recorded
    ).toBe(false);
  }
);

test("renamed login keeps identity while unverified editor leaves coverage unknown", () => {
  const renamed = report({
    author: { ...actor, login: "new-name" },
    body: "",
    surface: "review",
  });
  expect(
    collected(observed({ reviews: [renamed] })).reviewFindings.recorded
  ).toBe(true);
  renamed.editor = { id: 999, login: "foreign", type: "User" };
  const result = collected(observed({ reviews: [renamed] }));
  expect(result.coverage.diagnostics).toContain("report-editor-unverified");
});

test("unqualified external surfaces always withhold completeness", () => {
  const args = input();
  const { policyDigest: _old, ...raw } = args.policy;
  args.policy = parseFindingSourcesPolicy({
    ...raw,
    unqualifiedSources: ["code-scanning"],
  });
  expect(configuredFindingInventory(args).coverage.diagnostics).toContain(
    "sources-unqualified"
  );
});

const codex = (adverse = false) =>
  `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: "b".repeat(40), has_any_findings: adverse, has_unresolved_findings: adverse, status: "completed" }, security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null } })} -->`;

test("structured Codex flags retain an unaccounted adverse entry even with resolved threads", () => {
  const result = collected(
    observed({
      comments: [
        report({ body: codex(true), state: null, surface: "issue-comment" }),
      ],
      threads: [thread({ isResolved: true })],
    })
  );
  expect(result.reviewFindings.recorded).toBe(true);
  expect(
    result.reviewFindings.findings.find(
      (finding) => finding.kind === "adverse-review"
    )?.resolution
  ).toBeNull();
});

test.each(["trailing adverse prose", "<!-- unqualified hidden report -->"])(
  "Codex surrounding text stays unknown: %s",
  (extra) => {
    expect(
      classifyFindingReport(
        report({ body: `${codex()}\n${extra}`, surface: "issue-comment" }),
        ["codex-summary-v1"],
        actor.id
      ).known
    ).toBe(false);
  }
);

test.each([
  "**Devin Review** found 0 potential issues.\n<!-- devin-review-badge-begin -->new adverse prose<!-- devin-review-badge-end -->",
  "<!-- linear-linkback -->\n<details><summary>Link</summary>There is a new finding</details>",
  '<!-- linear-linkback -->\n<p><a href="https://linear.app/outfitter/issue/FOR-60">FOR-60</a></p>\nextra finding',
])("wrapping arbitrary prose never classifies it clean", (body) => {
  expect(
    classifyFindingReport(
      report({
        body,
        surface: body.startsWith("**") ? "review" : "issue-comment",
      }),
      sourcePolicy().sources[0]?.formats ?? [],
      actor.id
    ).known
  ).toBe(false);
});

test("modern operational linkback is bound to its exact supported surface and grammar", () => {
  const body =
    '<!-- linear-linkback -->\n<p><a href="https://linear.app/outfitter/issue/FOR-60">FOR-60</a></p>';
  expect(
    classifyFindingReport(
      report({ body, surface: "issue-comment" }),
      ["linear-linkback-v1"],
      actor.id
    )
  ).toEqual({ adverse: false, known: true });
  expect(
    classifyFindingReport(
      report({ body, surface: "review" }),
      ["linear-linkback-v1"],
      actor.id
    ).known
  ).toBe(false);
});

test("pure evaluator checks current scoped coverage, immutable source and exact collector run", () => {
  const args = input(observed({ threads: [thread({ isResolved: true })] }));
  const pr = passingPrV2();
  pr.reviewFindings = configuredFindingInventory(args).reviewFindings;
  const policy = policyV2().agentReview;
  policy.findingSources = authority(args);
  const evaluate = () =>
    evaluateLedger(
      { credible: new Set([localAttempt()]), policy, pr },
      "findings"
    );
  expect(evaluate().blockers).toEqual([]);
  const resolution = pr.reviewFindings.findings[0]?.resolution;
  if (resolution === null || resolution === undefined) {
    throw new Error("missing resolution");
  }
  resolution.provenance.runId = "copied-old-run";
  expect(evaluate().blockers.map((reason) => reason.code)).toContain(
    "blocking-findings"
  );
  resolution.provenance.runId = pr.provenance.runId;
  const [configuredAccount] = policy.findingSources.sourceAccounts;
  if (!configuredAccount) {
    throw new Error("missing source account");
  }
  configuredAccount.accountId = 456;
  expect(evaluate().blockers.map((reason) => reason.code)).toContain(
    "findings-unknown"
  );
  expect(evaluate().blockers.map((reason) => reason.code)).toContain(
    "blocking-findings"
  );
  policy.findingSources = authority(args);
  delete pr.reviewFindings.coverage;
  expect(evaluate().blockers.map((reason) => reason.code)).toContain(
    "findings-unknown"
  );
  pr.reviewFindings = configuredFindingInventory(args).reviewFindings;
  delete policy.findingSources;
  expect(evaluate().blockers.map((reason) => reason.code)).toContain(
    "findings-unknown"
  );
});

test("historical reports retain their actual service origin on first observation at a newer head", () => {
  const original = report({
    commitId: "c".repeat(40),
    state: "CHANGES_REQUESTED",
  });
  const args = input(observed({ reviews: [original], threads: [thread()] }));
  args.subject = {
    ...args.subject,
    baseSha: "e".repeat(40),
    headSha: "d".repeat(40),
  };
  const result = configuredFindingInventory(args);
  expect(
    result.reviewFindings.findings.map((finding) => finding.attemptId)
  ).toEqual([
    "configured-report/reporter/report-1",
    "configured-report/reporter/report-1",
  ]);
  expect(
    result.reviewFindings.findings.some((finding) =>
      finding.attemptId.includes(args.subject.headSha)
    )
  ).toBe(false);
});

test("an unattributable changes-requested review preserves positive adverse evidence", () => {
  const result = collected(
    observed({
      reviews: [report({ author: null, state: "CHANGES_REQUESTED" })],
    })
  );
  expect(result.reviewFindings.recorded).toBe(false);
  expect(result.reviewFindings.findings).toMatchObject([
    {
      kind: "adverse-review",
      resolution: null,
      reviewer: "unattributed-github-report",
    },
  ]);
});

test.each([
  `${codex()}\n${codex()}`,
  `${codex()}\n<!-- codex-review-state:v1`,
  codex().replace("codex-review-state:v1", "codex-review-state:v2"),
  codex().replace(" -->", " malformed -->"),
  `extra prose\n${codex()}`,
  `${codex()}\nextra prose`,
])("ambiguous or malformed Codex envelopes stay unknown", (body) => {
  expect(
    classifyFindingReport(
      report({ body, surface: "issue-comment" }),
      ["codex-summary-v1"],
      actor.id
    ).known
  ).toBe(false);
});

test("multiple Codex blocks preserve positive adverse flags while coverage stays unknown", () => {
  expect(
    classifyFindingReport(
      report({ body: `${codex()}\n${codex(true)}`, surface: "issue-comment" }),
      ["codex-summary-v1"],
      actor.id
    )
  ).toEqual({ adverse: true, known: false });
});

test("many nested Codex prefixes are scanned without parsing overlapping report bodies", () => {
  const body = `${"<!-- codex-review-state:v1 ".repeat(10_000)}${codex(true)}`;
  expect(
    classifyFindingReport(
      report({ body, surface: "issue-comment" }),
      ["codex-summary-v1"],
      actor.id
    )
  ).toEqual({ adverse: true, known: false });
});

const cursorQuota =
  "<h3>Bugbot couldn't run - usage limit reached</h3>\n\nBugbot is counted against Cursor usage for this user or team, and this run hit a usage or spend limit.\n\nA user or team admin can review and increase usage limits in the [Cursor dashboard](https://www.cursor.com/dashboard/spending).\n\n(requestId: 12345678-1234-1234-1234-123456789abc)";

test.each([codex(), cursorQuota])(
  "each allowed format remains recognized when a source supports both",
  (body) => {
    expect(
      classifyFindingReport(
        report({ body, surface: "issue-comment" }),
        ["codex-summary-v1", "cursor-summary-v1"],
        actor.id
      )
    ).toEqual({ adverse: false, known: true });
  }
);

test.each([
  `${codex()}\n${cursorQuota}`,
  `<!-- codex-review-state:v1\n${cursorQuota}`,
  `${cursorQuota}\n<!-- codex-pull-request-review-summary`,
])(
  "mixed or malformed Codex text cannot fall through to another clean format",
  (body) => {
    expect(
      classifyFindingReport(
        report({ body, surface: "issue-comment" }),
        ["codex-summary-v1", "cursor-summary-v1"],
        actor.id
      ).known
    ).toBe(false);
  }
);
