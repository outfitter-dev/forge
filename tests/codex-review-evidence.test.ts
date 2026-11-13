import { expect, test } from "bun:test";

import { codexReviewEvidence } from "../src/index.ts";
import { localAttempt } from "./agent-review-fixtures.ts";
import {
  DEADLINE,
  evaluate,
  evidence,
  input,
  READ,
  START,
  summary,
  thread,
} from "./codex-review-fixtures.ts";
import { BASE, HEAD, subject } from "./evidence-fixtures.ts";

test("a bound clean report with attested independence and complete findings passes the real evaluator", () => {
  const result = evidence();
  expect(result.agentReviews[0]).toMatchObject({
    complete: true,
    context: "none",
    deadlineAt: DEADLINE,
    findingIds: [],
    harness: null,
    instructions: null,
    launch: "unknown",
    model: null,
    observedAt: READ,
    startedAt: START,
    state: "completed",
    subject: subject(12),
    verdict: "passed",
  });
  expect(result.reviewLadder).toBeNull();
  expect(result.reviewFindings).toEqual({ findings: [], recorded: true });
  expect(evaluate(result)).toEqual({
    codes: [],
    conclusion: "success",
    eligible: true,
  });
});

test.each([
  {
    code: "review-unavailable",
    name: "missing summary",
    observation: summary({}, { body: "no summary" }),
  },
  {
    code: "review-unavailable",
    name: "malformed marker",
    observation: summary(
      {},
      {
        body: "<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {bad} -->",
      }
    ),
  },
  {
    code: "review-unavailable",
    name: "wrong bot account with same login",
    observation: summary(
      {},
      {
        author: { __typename: "Bot", databaseId: 99, login: "review-bot[bot]" },
      }
    ),
  },
  {
    code: "review-unavailable",
    name: "human last editor",
    observation: summary(
      {},
      { editor: { __typename: "User", databaseId: 99, login: "human" } }
    ),
  },
  {
    code: "review-unavailable",
    name: "unknown last editor",
    observation: summary({}, { editor: null }),
  },
  {
    code: "review-pending",
    name: "older reviewed head",
    observation: summary({ commit_sha: "c".repeat(40) }),
  },
  {
    code: "review-pending",
    name: "noncompleted current state",
    observation: summary({ status: "in_progress" }),
  },
])("$name cannot qualify a clean current review", ({ code, observation }) => {
  const result = evidence({ summary: observation });
  const decision = evaluate(result);
  expect(decision.conclusion).toBe("failure");
  expect(decision.codes).toContain(code);
  expect(result.agentReviews[0].verdict).toBe("unknown");
});

test.each([
  { name: "missing", snapshot: null },
  {
    name: "different base",
    snapshot: { baseSha: "c".repeat(40), headSha: HEAD, observedAt: START },
  },
  {
    name: "effective snapshot reset after a base event",
    snapshot: { baseSha: BASE, headSha: HEAD, observedAt: READ },
  },
])("$name snapshot cannot bind a current-looking report", ({ snapshot }) => {
  const result = evidence({ snapshot });
  expect(evaluate(result).codes).toContain("review-unavailable");
  expect(result.agentReviews[0].complete).toBe(false);
});

test.each([START, "2026-01-01T00:11:01Z"])(
  "summary updated at %s cannot cross the snapshot/read time bounds",
  (updatedAt) => {
    expect(
      evaluate(evidence({ summary: summary({}, { updatedAt }) })).codes
    ).toContain("review-unavailable");
  }
);

test("summary updated exactly at servedAt is bound", () => {
  expect(
    evaluate(evidence({ summary: summary({}, { updatedAt: READ }) })).eligible
  ).toBe(true);
});

test.each([
  summary({ commit_sha: "c".repeat(40) }),
  summary({ status: "queued" }),
])(
  "stale or noncompleted reports become unavailable at the stable deadline",
  (observation) => {
    const result = evidence({ servedAt: DEADLINE, summary: observation });
    expect(result.agentReviews[0]).toMatchObject({
      deadlineAt: DEADLINE,
      state: "unavailable",
      unavailableReason: "timeout",
    });
    expect(evaluate(result).codes).toContain("review-unavailable");
  }
);

test("a credible completed report after the deadline remains usable", () => {
  expect(
    evaluate(evidence({ servedAt: "2026-01-01T00:16:00Z" })).eligible
  ).toBe(true);
});

test.each(
  [
    null,
    { botAccountId: 99 },
    { repository: "other/repo" },
    { reviewer: "other-reviewer" },
  ].map((override) => ({ override }))
)(
  "missing or inapplicable attestation cannot assert independence",
  ({ override }) => {
    const base = input();
    if (base.attestation === null) {
      throw new Error("missing fixture attestation");
    }
    const attestation =
      override === null ? null : { ...base.attestation, ...override };
    const result = evidence({ attestation });
    expect(result.agentReviews[0].context).toBe("unknown");
    expect(result.diagnostics).toContain("independence-unattested");
    expect(evaluate(result).codes).toContain("review-not-independent");
  }
);

test.each([undefined, false])(
  "absent or false explicit completeness keeps finding history unknown",
  (findingsComplete) => {
    const given = input();
    if (findingsComplete === undefined) {
      delete given.findingsComplete;
    } else {
      given.findingsComplete = findingsComplete;
    }
    const result = codexReviewEvidence(given);
    expect(result.reviewFindings.recorded).toBe(false);
    expect(evaluate(result).codes).toContain("findings-unknown");
  }
);

test("stable identity and deadlines survive polling, run IDs, summary edits and property order", () => {
  const first = evidence();
  const { baseSha, ...otherSubjectFields } = subject(12);
  const second = evidence({
    issuer: { ...input().issuer, runId: "later-poll" },
    servedAt: "2026-01-01T00:12:00Z",
    subject: { ...otherSubjectFields, baseSha },
    summary: summary({}, { updatedAt: "2026-01-01T00:11:30Z" }),
  });
  expect(second.agentReviews[0].attemptId).toBe(
    first.agentReviews[0].attemptId
  );
  expect(second.agentReviews[0].deadlineAt).toBe(
    first.agentReviews[0].deadlineAt
  );
  expect(second.agentReviews[0].startedAt).toBe(
    first.agentReviews[0].startedAt
  );
  const changed = evidence({
    snapshot: {
      baseSha: BASE,
      headSha: HEAD,
      observedAt: "2026-01-01T00:01:00Z",
    },
  });
  expect(changed.agentReviews[0].attemptId).not.toBe(
    first.agentReviews[0].attemptId
  );
});

test("observations retain policy attestation and parsed source facts without comment bodies", () => {
  const result = evidence();
  expect(result.observations.attestation).toEqual(input().attestation);
  expect(result.observations.summary.comment).toMatchObject({
    id: 500,
    nodeId: "IC_500",
    updatedAt: "2026-01-01T00:10:00Z",
  });
  expect(result.observations.summary.state?.codeReview.commitSha).toBe(HEAD);
  expect(JSON.stringify(result)).not.toContain("private summary prose");
  expect(JSON.stringify(result)).not.toContain("codex-review-state:v1");
});

test("another clean reviewer cannot resolve a contradictory clean-summary thread", () => {
  const result = evidence({ threads: [thread()] });
  expect(result.agentReviews[0]).toMatchObject({
    complete: true,
    state: "completed",
    verdict: "failed",
  });
  expect(result.diagnostics).toContain("summary-thread-conflict");
  expect(
    evaluate(result, [localAttempt({ subject: subject(12) })]).codes
  ).toContain("blocking-findings");
});

test("active clean-looking security state remains unsupported", () => {
  const active = {
    commit_sha: HEAD,
    has_any_findings: false,
    has_unresolved_findings: false,
    status: "completed",
  };
  const result = evidence({ summary: summary({}, {}, active) });
  expect(result.diagnostics).toContain("security-state-unsupported");
  expect(evaluate(result).codes).toContain("review-unavailable");
});

test("invalid effective timestamps, duplicate threads, bad provenance and corrupt findings fail closed", () => {
  expect(() =>
    evidence({
      snapshot: {
        baseSha: BASE,
        headSha: HEAD,
        observedAt: "2026-01-01T01:00:00Z",
      },
    })
  ).toThrow();
  expect(() => evidence({ threads: [thread(), thread()] })).toThrow();
  expect(() =>
    evidence({ issuer: { ...input().issuer, producer: "wrong-issuer" } })
  ).toThrow();
  expect(() =>
    evidence({
      findings: { findings: [], recorded: null as unknown as boolean },
    })
  ).toThrow();
  expect(() => evidence({ botAccountId: 0 })).toThrow();
  expect(() =>
    evidence({
      reviewer: { ...input().reviewer, waitSeconds: Number.MAX_SAFE_INTEGER },
    })
  ).toThrow();
});

test("the operation detaches its evidence, findings, source and attestation objects", () => {
  const given = input({ threads: [thread("resolved", true)] });
  const before = structuredClone(given);
  const result = codexReviewEvidence(given);
  expect(given).toEqual(before);
  expect(result.observations.attestation).not.toBe(given.attestation);
  expect(result.observations.threads[0]).not.toBe(given.threads[0]);
  expect(result.agentReviews[0].subject).not.toBe(given.subject);
});

test("corrupted finding input cannot leak source field names through an error", () => {
  const marker = "private-source-field";
  const sourceFields = { [marker]: marker };
  const findings = { ...sourceFields, findings: [], recorded: true };
  try {
    evidence({ findings });
  } catch (error) {
    expect(String(error)).not.toContain(marker);
    expect(String(error)).toContain(
      "expected a valid unique persisted finding ledger"
    );
    return;
  }
  throw new Error("corrupted finding input accepted");
});
