import { expect, test } from "bun:test";

import { evaluateAgentReview } from "../src/agent-review-gate.ts";
import { digest } from "../src/check-config.ts";
import { classifyFindingReport } from "../src/configured-finding-classification.ts";
import { configuredFindingInventory } from "../src/configured-finding-inventory.ts";
import type { ReviewFindingLedger } from "../src/evidence-types.ts";
import { parseFindingSourcesPolicy } from "../src/finding-source-policy.ts";
import type {
  FindingObservation,
  FindingReport,
} from "../src/github-finding-observations.ts";
import { applyReviewFollowUps } from "../src/review-follow-up.ts";
import { passingPrV2, policyV2 } from "./agent-review-fixtures.ts";
import { fakeAdapter, secondary } from "./review-collection-fixtures.ts";

const account = { id: 123, login: "observed-reporting-bot", type: "Bot" };
const sources = (accountId = account.id) =>
  parseFindingSourcesPolicy({
    policyRevision: "a".repeat(40),
    resolution: "github-native",
    sources: [
      {
        accountId,
        actorType: "Bot",
        externalCoverage: "qualified",
        formats: ["github-thread-v1", "devin-review-v1"],
        qualificationRef: "fixture://observed-report-shape",
        reviewer: "reporter",
        surfaces: ["review", "issue-comment", "thread-comment"],
      },
    ],
    unqualifiedSources: [],
  });
const badge =
  '<!-- devin-review-badge-begin -->\n<a href="https://app.devin.ai/review/outfitter-dev/forge/pull/82" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="https://static.devin.ai/assets/gh-devin-review-dark.svg?v=4"><img src="https://static.devin.ai/assets/gh-devin-review-light.svg?v=4" alt="Devin Review"></picture></a>\n<!-- devin-review-badge-end -->';
// Public shape observed on Forge PR82 review6045016065, with fixture actor identity.
const summary = `**Devin Review** found 3 potential issues.\n\n${badge}`;
const report = (overrides: Partial<FindingReport> = {}): FindingReport => ({
  author: account,
  body: summary,
  commitId: "b".repeat(40),
  editor: account,
  id: "observed-report",
  lastEditedAt: null,
  nativeRef:
    "https://github.com/outfitter-dev/forge/pull/82#pullrequestreview-6045016065",
  nodeId: "observed-report",
  state: "COMMENTED",
  surface: "review",
  updatedAt: "2026-01-01T00:20:00Z",
  ...overrides,
});
const observed = (reports: FindingReport[]): FindingObservation => ({
  comments: [],
  reviews: reports,
  threads: [],
});
const inventory = (
  reports: FindingReport[],
  findings: ReviewFindingLedger,
  policy = sources()
) => {
  const pr = passingPrV2();
  return configuredFindingInventory({
    findings,
    first: observed(reports),
    issuer: pr.provenance,
    policy,
    second: observed(structuredClone(reports)),
    subject: pr.subject,
  });
};

test.each([
  [summary, true],
  [summary.replace("3 potential issues", "1 potential issue"), true],
  [
    summary
      .replace("3 potential issues", "1 potential issue")
      .replace("pull/82", "pull/85"),
    false,
  ],
] as const)(
  "the observed report %s survives inventory collection with coverage %p",
  (body, known) => {
    expect(
      classifyFindingReport(report({ body }), ["devin-review-v1"], account.id)
    ).toEqual({ adverse: true, known });
    const result = inventory([report({ body })], {
      findings: [],
      recorded: false,
    });
    expect(result.reviewFindings.recorded).toBe(known);
    expect(result.reviewFindings.findings).toMatchObject([
      {
        kind: "adverse-review",
        reportingSource: { accountId: 123, actorType: "Bot" },
        resolution: null,
      },
    ]);
  }
);

test.each([
  ["1 potential issue", true],
  ["2 potential issues", true],
  ["1 potential issues", false],
  ["2 potential issue", false],
] as const)(
  "Devin summary grammar %s has known classification %s",
  (phrase, known) => {
    const body = summary.replace("3 potential issues", phrase);
    expect(
      classifyFindingReport(report({ body }), ["devin-review-v1"], account.id)
    ).toEqual({ adverse: true, known });
  }
);

test("the singular observed summary remains adverse when its badge or prose changes", () => {
  const body = summary.replace("3 potential issues", "1 potential issue");
  for (const altered of [
    body.replace("pull/82", "pull/85"),
    `${body} additional report`,
  ]) {
    expect(
      classifyFindingReport(
        report({ body: altered }),
        ["devin-review-v1"],
        account.id
      )
    ).toEqual({ adverse: true, known: false });
  }
});

test.each([
  summary.replace('alt="Devin Review"', 'alt="new finding"'),
  summary.replace(
    "<!-- devin-review-badge-end -->",
    "new unparsed finding<!-- devin-review-badge-end -->"
  ),
  `${summary}\nextra adverse prose`,
  summary.replace('pull/82" target', 'pull/83" target'),
  summary.replace(
    "gh-devin-review-dark.svg?v=4",
    "gh-devin-review-dark.svg?v=5"
  ),
  summary.replace("found 3", "found 0"),
])("unsupported Devin badge or text stays unknown", (body) => {
  expect(
    classifyFindingReport(report({ body }), ["devin-review-v1"], account.id)
      .known
  ).toBe(false);
});

test.each([
  "unchanged-devin-report",
  "unknown-bot-now-absent",
  "unknown-bot-now-adopted",
] as const)(
  "an exact trusted follow-up clears its retained adverse entry (%s)",
  (mode) => {
    const firstPolicy = mode.startsWith("unknown-bot")
      ? sources(999)
      : sources();
    const initialReport = report(
      mode.startsWith("unknown-bot")
        ? { body: "", state: "CHANGES_REQUESTED" }
        : {}
    );
    const first = inventory(
      [initialReport],
      { findings: [], recorded: false },
      firstPolicy
    );
    const [accepted] = first.reviewFindings.findings;
    if (!accepted) {
      throw new Error("expected retained adverse entry");
    }
    expect(accepted.reportingSource).toEqual({
      accountId: 123,
      actorType: "Bot",
    });
    const currentPolicy = sources();
    const current = inventory(
      mode === "unknown-bot-now-absent" ? [] : [initialReport],
      first.reviewFindings,
      currentPolicy
    );
    expect(current.reviewFindings.recorded).toBe(true);
    expect(current.reviewFindings.findings).toHaveLength(1);
    const pr = passingPrV2();
    const entry = secondary();
    const input = {
      findings: current.reviewFindings,
      reviewThreads: [],
      servedAt: "2026-01-01T00:25:00Z",
      snapshot: null,
      subject: pr.subject,
    };
    const followup = fakeAdapter().normalize(
      entry,
      { source: "stable" },
      input
    );
    const [attempt] = followup.agentReviews;
    if (!attempt) {
      throw new Error("expected independent follow-up attempt");
    }
    followup.reviewFindings = current.reviewFindings;
    followup.followUpResolutions = [
      {
        attemptId: attempt.attemptId,
        disposition: "fixed",
        finding: {
          attemptId: accepted.attemptId,
          id: accepted.id,
          nativeRef: accepted.nativeRef,
          reviewer: accepted.reviewer,
        },
        nativeRef: "fixture://follow-up/exact-origin",
      },
    ];
    const withoutLink = applyReviewFollowUps(
      { ...followup, followUpResolutions: [] },
      entry,
      input
    );
    expect(withoutLink.findings[0]?.resolution).toBeNull();
    const wrongOrigin = structuredClone(followup);
    if (wrongOrigin.followUpResolutions?.[0]) {
      wrongOrigin.followUpResolutions[0].finding.nativeRef =
        "fixture://unrelated";
    }
    expect(
      applyReviewFollowUps(wrongOrigin, entry, input).findings[0]?.resolution
    ).toBeNull();
    pr.reviewFindings = applyReviewFollowUps(followup, entry, input);
    pr.agentReviews = followup.agentReviews;
    const policy = policyV2().agentReview;
    policy.findingSources = {
      policyDigest: currentPolicy.policyDigest,
      policyRevision: currentPolicy.policyRevision,
      reviewers: currentPolicy.sources.map((source) => source.reviewer),
      sourceAccounts: currentPolicy.sources.map(
        ({ accountId, actorType, reviewer }) => ({
          accountId,
          actorType,
          reviewer,
        })
      ),
    };
    const decision = evaluateAgentReview(pr, policy, "pullRequest", false);
    expect(decision.reasons).toEqual([]);
    expect(decision.outcome.disposition).toBe("satisfied");
    expect(
      inventory(
        mode === "unknown-bot-now-absent" ? [] : [initialReport],
        pr.reviewFindings,
        currentPolicy
      ).reviewFindings.findings[0]?.resolution?.kind
    ).toBe("follow-up-review");
  }
);

test("legacy Codex thread origin needs its explicit current installed-source bridge", () => {
  const policy = sources();
  const legacy = {
    attemptId: "codex/original-review",
    id: "legacy-thread",
    kind: "finding" as const,
    nativeRef: "legacy-thread",
    resolution: null,
    reviewer: "reporter",
  };
  const observation: FindingObservation = {
    comments: [],
    reviews: [],
    threads: [
      {
        comments: [report({ surface: "thread-comment" })],
        id: "legacy-thread",
        isOutdated: true,
        isResolved: true,
      },
    ],
  };
  const pr = passingPrV2();
  const input = {
    findings: { findings: [legacy], recorded: false },
    first: observation,
    issuer: pr.provenance,
    policy,
    second: structuredClone(observation),
    subject: pr.subject,
  };
  expect(
    configuredFindingInventory(input).reviewFindings.findings[0]?.resolution
  ).toBeNull();
  const bridged = configuredFindingInventory({
    ...input,
    legacyCodexSources: [
      { accountId: account.id, actorType: "Bot", reviewer: "reporter" },
    ],
  });
  expect(bridged.reviewFindings.findings[0]?.reportingSource).toBeUndefined();
  expect(bridged.reviewFindings.findings[0]?.attemptId).toBe(legacy.attemptId);
  expect(bridged.reviewFindings.findings[0]?.resolution?.kind).toBe(
    "configured-native"
  );
  expect(bridged.reviewFindings.coverage?.legacySources).toEqual([
    {
      attemptId: legacy.attemptId,
      id: legacy.id,
      kind: legacy.kind,
      nativeRef: legacy.nativeRef,
      reportingSource: { accountId: account.id, actorType: "Bot" as const },
      reviewer: legacy.reviewer,
    },
  ]);
});

test.each([
  "unbridged",
  "wrong-attempt",
  "wrong-actor",
  "bridged",
  "same-recorded-actor",
] as const)(
  "legacy adverse reuse requires an exact observed source (%s)",
  (mode) => {
    const current = report({ databaseId: 777 });
    const legacy = {
      attemptId:
        mode === "wrong-attempt" ? "unrelated/review" : "codex/original-review",
      id: `adverse-review:777:${current.updatedAt}:${digest(current.body)}`,
      kind: "adverse-review" as const,
      nativeRef: current.nativeRef,
      ...(mode === "wrong-actor" || mode === "same-recorded-actor"
        ? {
            reportingSource: {
              accountId: mode === "wrong-actor" ? 999 : account.id,
              actorType: "Bot" as const,
            },
          }
        : {}),
      resolution: null,
      reviewer: "reporter",
    };
    const pr = passingPrV2();
    const result = configuredFindingInventory({
      findings: { findings: [legacy], recorded: false },
      first: observed([current]),
      issuer: pr.provenance,
      ...(mode === "unbridged" || mode === "same-recorded-actor"
        ? {}
        : {
            legacyCodexSources: [
              {
                accountId: account.id,
                actorType: "Bot" as const,
                reviewer: "reporter",
              },
            ],
          }),
      policy: sources(),
      second: observed([current]),
      subject: pr.subject,
    });
    const reusable = mode === "bridged" || mode === "same-recorded-actor";
    expect(result.reviewFindings.findings).toHaveLength(reusable ? 1 : 2);
    expect(result.reviewFindings.findings[0]).toEqual(legacy);
    expect(result.reviewFindings.coverage?.legacySources?.length ?? 0).toBe(
      mode === "bridged" ? 1 : 0
    );
    if (!reusable) {
      expect(result.reviewFindings.findings[1]).toMatchObject({
        reportingSource: { accountId: account.id, actorType: "Bot" },
        resolution: null,
      });
    }
  }
);

test.each(["open", "missing"] as const)(
  "legacy native thread cannot retain follow-up clearance when %s",
  (mode) => {
    const pr = passingPrV2();
    const resolution = {
      attemptId: "independent/follow-up",
      disposition: "fixed" as const,
      kind: "follow-up-review" as const,
      nativeRef: "fixture://follow-up",
      provenance: pr.provenance,
      subject: pr.subject,
    };
    const legacy = {
      attemptId: "codex/original-review",
      id: "legacy-thread",
      kind: "finding" as const,
      nativeRef: "legacy-thread",
      resolution,
      reviewer: "reporter",
    };
    const observation: FindingObservation = {
      comments: [],
      reviews: [],
      threads:
        mode === "missing"
          ? []
          : [
              {
                comments: [report({ surface: "thread-comment" })],
                id: legacy.id,
                isOutdated: true,
                isResolved: false,
              },
            ],
    };
    const result = configuredFindingInventory({
      findings: { findings: [legacy], recorded: false },
      first: observation,
      issuer: pr.provenance,
      legacyCodexSources: [
        { accountId: account.id, actorType: "Bot", reviewer: "reporter" },
      ],
      policy: sources(),
      second: structuredClone(observation),
      subject: pr.subject,
    });
    expect(result.reviewFindings.findings[0]).toEqual({
      ...legacy,
      resolution: null,
    });
  }
);

test.each(["adverse", "other-native-reference", "other-collector"] as const)(
  "unrelated legacy follow-up remains intact (%s)",
  (mode) => {
    const pr = passingPrV2();
    const resolution = {
      attemptId: "independent/follow-up",
      disposition: "fixed" as const,
      kind: "follow-up-review" as const,
      nativeRef: "fixture://follow-up",
      provenance: pr.provenance,
      subject: pr.subject,
    };
    const legacy = {
      attemptId:
        mode === "other-collector"
          ? "another-collector/review"
          : "codex/original-review",
      id: "legacy-entry",
      kind:
        mode === "adverse" ? ("adverse-review" as const) : ("finding" as const),
      nativeRef:
        mode === "other-native-reference"
          ? "fixture://another-reference"
          : "legacy-entry",
      resolution,
      reviewer: "reporter",
    };
    const result = inventory([], { findings: [legacy], recorded: false });
    expect(result.reviewFindings.findings[0]).toEqual(legacy);
  }
);
