import { expect, test } from "bun:test";

import {
  previewBuildkiteStatusRefresh,
  selectBuildkiteStatusRefresh,
} from "../src/buildkite-status-refresh.ts";
import type { GateStatusDocument } from "../src/buildkite-status-refresh.ts";
import { evaluateEvidence } from "../src/evaluate-evidence.ts";
import type { GitHubPullRequest } from "../src/github-pull-request-types.ts";
import { passingFactsV2, policyV2 } from "./agent-review-fixtures.ts";
import {
  BASE,
  HEAD,
  REPOSITORY,
  subject as evidenceSubject,
} from "./evidence-fixtures.ts";

const policy = { holdLabel: "forge:hold", repository: REPOSITORY };
const target = { pullRequest: 1, repository: REPOSITORY };
const pull: GitHubPullRequest = {
  author: { id: 10, login: "fixture", type: "User" },
  base: {
    ref: "stack-parent",
    repositoryId: 1,
    repositoryName: REPOSITORY,
    sha: BASE,
  },
  draft: false,
  head: { ref: "stack-child", repositoryId: 1, sha: HEAD },
  labels: [],
  mergeable: true,
  merged: false,
  number: 1,
  requestedReviewers: [],
  requestedTeams: [],
  state: "open",
};
const subject = { ...target, baseSha: BASE, headSha: HEAD };
const frame = { kind: "forge-gate", schemaVersion: 1 } as const;
const deliver = (
  event: string,
  action: string,
  extra: Record<string, unknown> = {}
) =>
  selectBuildkiteStatusRefresh(
    event,
    {
      action,
      pull_request: { head: { sha: "f".repeat(40) }, number: 1 },
      repository: { full_name: REPOSITORY.toUpperCase() },
      ...extra,
    },
    policy
  );

const gateFor = (
  runId: string,
  overrides: Partial<ReturnType<typeof passingFactsV2>["pullRequest"]> = {}
) => {
  const facts = passingFactsV2();
  Object.assign(facts.pullRequest, overrides);
  const evaluation = evaluateEvidence(facts, policyV2());
  if (evaluation.status !== "evaluated") {
    throw new Error("Invalid gate fixture");
  }
  return {
    ...frame,
    eligible: evaluation.eligible,
    evaluation,
    rejectedReceipts: [],
    runId,
    status: "evaluated",
    subject,
  } satisfies GateStatusDocument;
};

const preview = (
  overrides: Partial<Parameters<typeof previewBuildkiteStatusRefresh>[0]> = {}
) =>
  previewBuildkiteStatusRefresh({
    admitted: pull,
    current: pull,
    gate: gateFor("fresh"),
    policy,
    runId: "fresh",
    target,
    ...overrides,
  });

test.each([
  ["pull_request_review", "submitted"],
  ["pull_request_review", "dismissed"],
  ["pull_request_review_thread", "resolved"],
  ["pull_request_review_thread", "unresolved"],
])("uses %s %s only to select a PR for fresh collection", (event, action) => {
  expect(deliver(event, action)).toEqual(target);
});

test("ignores unrelated events, repositories, labels, and non-PR comments", () => {
  expect(deliver("pull_request", "synchronize")).toBeNull();
  expect(
    deliver("pull_request", "labeled", { label: { name: "not-held" } })
  ).toBeNull();
  expect(
    selectBuildkiteStatusRefresh(
      "pull_request",
      {
        action: "labeled",
        label: { name: "forge:blocK" },
        pull_request: { number: 1 },
        repository: { full_name: REPOSITORY },
      },
      { ...policy, holdLabel: "forge:block" }
    )
  ).toBeNull();
  expect(
    deliver("issue_comment", "created", {
      issue: { number: 1, pull_request: {} },
    })
  ).toBeNull();
  expect(
    deliver("pull_request_review", "submitted", {
      repository: { full_name: "fixture/foreign" },
    })
  ).toBeNull();
  expect(
    deliver("pull_request_review", "submitted", {
      pull_request: { number: "1" },
    })
  ).toBeNull();
  expect(
    selectBuildkiteStatusRefresh("pull_request_review", null, policy)
  ).toBeNull();
});

test("adding and removing hold changes the preview at the same head and base", () => {
  const label = { id: 2, name: "FORGE:HOLD" };
  const held = { ...pull, labels: [label] };
  expect(deliver("pull_request", "labeled", { label })).toEqual(target);
  expect(
    preview({
      current: held,
      gate: gateFor("held", { mergeAuthorized: false }),
      runId: "held",
    })
  ).toEqual({ eligible: false, status: "preview", subject });
  expect(deliver("pull_request", "unlabeled", { label })).toEqual(target);
  expect(
    preview({
      admitted: held,
      gate: gateFor("unheld"),
      runId: "unheld",
    })
  ).toEqual({ eligible: true, status: "preview", subject });
});

test("reopening and resolving a thread changes the fresh gate at the same revisions", () => {
  expect(
    preview({
      gate: gateFor("reopened", { unresolvedThreads: 1 }),
      runId: "reopened",
    })
  ).toEqual({ eligible: false, status: "preview", subject });
  expect(
    preview({
      gate: gateFor("resolved", { unresolvedThreads: 0 }),
      runId: "resolved",
    })
  ).toEqual({ eligible: true, status: "preview", subject });
});

test("submitted and dismissed approvals can change the verdict on one revision", () => {
  const assignments = { recorded: true, requiredReviewers: ["reviewer"] };
  for (const state of ["approved", "dismissed"] as const) {
    const gate = gateFor(state, {
      assignments,
      humanReviews: [
        { reviewer: "reviewer", state, subject: evidenceSubject() },
      ],
    });
    expect(preview({ gate, runId: state })).toEqual({
      eligible: state === "approved",
      status: "preview",
      subject,
    });
  }
});

test.each([
  { ...pull, state: "closed" as const },
  { ...pull, merged: true },
  { ...pull, number: 2 },
  { ...pull, base: { ...pull.base, repositoryName: "fixture/foreign" } },
  { ...pull, head: { ...pull.head, repositoryId: 2 } },
  { ...pull, head: { ...pull.head, repositoryId: null } },
  null,
])(
  "refuses a missing, ineligible, or different PR on either read",
  (different) => {
    expect(preview({ admitted: different })).toEqual({
      reason: "admission-refused",
      status: "withheld",
    });
    expect(preview({ current: different })).toEqual({
      reason: "revision-changed",
      status: "withheld",
    });
  }
);

test.each([
  { ...pull, base: { ...pull.base, sha: "c".repeat(40) } },
  { ...pull, head: { ...pull.head, sha: "c".repeat(40) } },
  {
    ...pull,
    base: { ...pull.base, repositoryId: 2 },
    head: { ...pull.head, repositoryId: 2 },
  },
])("withholds a result if a revision or repository changed", (current) => {
  expect(preview({ current })).toEqual({
    reason: "revision-changed",
    status: "withheld",
  });
});

const staleCases: Partial<
  Parameters<typeof previewBuildkiteStatusRefresh>[0]
>[] = [
  { gate: gateFor("old-run") },
  {
    gate: {
      ...gateFor("fresh"),
      subject: { ...subject, baseSha: "c".repeat(40) },
    },
  },
  { gate: { ...gateFor("fresh"), eligible: false } },
  { gate: gateFor("fresh", { subject: evidenceSubject(2) }) },
  { current: { ...pull, draft: true } },
  { current: { ...pull, labels: [{ id: 2, name: "forge:hold" }] } },
  { current: { ...pull, mergeable: null } },
];
test.each(staleCases)(
  "withholds stale or inconsistent gate results",
  (overrides) => {
    expect(preview(overrides)).toEqual({
      reason: "gate-mismatch",
      status: "withheld",
    });
  }
);

test("a missing or unevaluated gate yields no status preview", () => {
  expect(preview({ gate: null })).toEqual({
    reason: "gate-unavailable",
    status: "withheld",
  });
  expect(
    preview({
      gate: {
        ...frame,
        code: "base-mismatch",
        stage: "subject",
        status: "not-collected",
      },
    })
  ).toEqual({ reason: "gate-unavailable", status: "withheld" });
});

test.each([1, 2] as const)(
  "version %s gate status facts are explicitly compatible",
  (schemaVersion) => {
    expect(
      preview({ gate: { ...gateFor("fresh"), schemaVersion } })
    ).toMatchObject({ eligible: true, status: "preview" });
  }
);
