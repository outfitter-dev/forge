import { expect, test } from "bun:test";

import { parseCodexSummary } from "../src/index.ts";
import {
  finding,
  followUp,
  HOSTED,
  localAttempt,
  nativeResolution,
  policyV2,
} from "./agent-review-fixtures.ts";
import {
  DEADLINE,
  evaluate,
  evidence,
  input,
  summary,
  thread,
} from "./codex-review-fixtures.ts";
import { subject } from "./evidence-fixtures.ts";

test("a completed adverse review records its native thread and remains completed failed evidence", () => {
  const result = evidence({
    summary: summary({ has_any_findings: true, has_unresolved_findings: true }),
    threads: [thread()],
  });
  expect(result.agentReviews[0]).toMatchObject({
    complete: true,
    findingIds: ["T1"],
    state: "completed",
    verdict: "failed",
  });
  expect(result.reviewFindings.findings).toEqual([
    {
      attemptId: result.agentReviews[0].attemptId,
      id: "T1",
      kind: "finding",
      nativeRef: "T1",
      resolution: null,
      reviewer: HOSTED,
    },
  ]);
  expect(evaluate(result).codes).toContain("blocking-findings");
});

test("resolved threads receive native resolutions without rewriting their original finding identity", () => {
  const original = finding({ id: "T1", reviewer: HOSTED });
  const result = evidence({
    findings: { findings: [original], recorded: true },
    threads: [thread("T1", true)],
  });
  expect(result.reviewFindings.findings[0]).toEqual({
    ...original,
    resolution: { kind: "native", nativeRef: "T1", provenance: input().issuer },
  });
  expect(evaluate(result).eligible).toBe(true);
});

test.each([false, true])(
  "missing or reopened native-resolved threads restore the blocker",
  (reopened) => {
    const previous = finding({
      id: "T1",
      resolution: nativeResolution(),
      reviewer: HOSTED,
    });
    const result = evidence({
      findings: { findings: [previous], recorded: true },
      threads: reopened ? [thread()] : [],
    });
    expect(result.reviewFindings.findings[0]?.resolution).toBeNull();
    expect(
      evaluate(result, [localAttempt({ subject: subject(12) })]).codes
    ).toContain("blocking-findings");
  }
);

test("other reviewers and disappeared explicit follow-up resolutions are preserved", () => {
  const other = finding({ resolution: nativeResolution() });
  const own = finding({
    id: "T1",
    resolution: followUp({ subject: subject(12) }),
    reviewer: HOSTED,
  });
  const result = evidence({
    findings: { findings: [other, own], recorded: true },
  });
  expect(result.reviewFindings.findings).toEqual([other, own]);
});

test("an explicitly reopened thread clears a prior follow-up disposition", () => {
  const previous = finding({
    id: "T1",
    resolution: followUp({ subject: subject(12) }),
    reviewer: HOSTED,
  });
  const result = evidence({
    findings: { findings: [previous], recorded: true },
    threads: [thread()],
  });
  expect(result.reviewFindings.findings[0]?.resolution).toBeNull();
  expect(evaluate(result).codes).toContain("blocking-findings");
});

test("an observed native resolution replaces a stale follow-up disposition", () => {
  const previous = finding({
    id: "T1",
    resolution: followUp({ subject: subject(12) }),
    reviewer: HOSTED,
  });
  const result = evidence({
    findings: { findings: [previous], recorded: true },
    threads: [thread("T1", true)],
  });
  expect(result.reviewFindings.findings[0]).toEqual({
    ...previous,
    resolution: { kind: "native", nativeRef: "T1", provenance: input().issuer },
  });
  expect(evaluate(result).eligible).toBe(true);
});

test("a finding hidden by an unknown first author cannot keep a native resolution", () => {
  const previous = finding({
    id: "T1",
    resolution: nativeResolution(),
    reviewer: HOSTED,
  });
  const result = evidence({
    findings: { findings: [previous], recorded: true },
    threads: [{ ...thread(), firstAuthor: null }],
  });
  expect(result.reviewFindings.findings[0]?.resolution).toBeNull();
});

test("bot-login impostors and human threads are not attributed to Codex", () => {
  const result = evidence({
    threads: [
      {
        ...thread("human"),
        firstAuthor: {
          id: input().botAccountId,
          login: "review-bot[bot]",
          type: "User",
        },
      },
      {
        ...thread("impostor"),
        firstAuthor: { id: 99, login: "review-bot[bot]", type: "Bot" },
      },
    ],
  });
  expect(result.reviewFindings.findings).toEqual([]);
});

test("detail-less adverse review identifies its comment version and has no native exit", () => {
  const first = evidence({ summary: summary({ has_any_findings: true }) });
  const [synthetic] = first.reviewFindings.findings;
  if (!synthetic) {
    throw new Error("missing synthetic fixture finding");
  }
  expect(synthetic.id).toMatch(
    /^adverse-review:500:2026-01-01T00:10:00Z:[\da-f]{64}$/u
  );
  expect(first.agentReviews[0]).toMatchObject({
    findingIds: [synthetic.id],
    state: "completed",
    verdict: "failed",
  });
  expect(synthetic).toMatchObject({
    kind: "adverse-review",
    nativeRef: "https://github.com/example/project/pull/12#issuecomment-500",
    resolution: null,
  });
  const later = evidence({
    findings: first.reviewFindings,
    threads: [thread("unrelated-resolved", true)],
  });
  expect(later.reviewFindings.findings[0]).toEqual(
    first.reviewFindings.findings[0]
  );
  expect(evaluate(later).codes).toContain("blocking-findings");
});

test.each([
  summary({ commit_sha: "c".repeat(40), has_any_findings: true }),
  summary(
    { has_any_findings: true },
    { editor: { __typename: "User", databaseId: 99, login: "human" } }
  ),
  summary({ has_any_findings: true, status: null }),
])(
  "stale or unavailable positive flags persist independently of current completion",
  (observation) => {
    const result = evidence({ servedAt: DEADLINE, summary: observation });
    expect(result.agentReviews[0].state).not.toBe("completed");
    expect(result.agentReviews[0].verdict).toBe("unknown");
    expect(result.reviewFindings.findings[0]).toMatchObject({
      kind: "adverse-review",
      resolution: null,
    });
    expect(
      evaluate(result, [localAttempt({ subject: subject(12) })]).codes
    ).toContain("blocking-findings");
  }
);

test("unaccounted unresolved flags retain synthetic blockers even when visible threads are resolved", () => {
  const result = evidence({
    summary: summary({ has_any_findings: true, has_unresolved_findings: true }),
    threads: [thread("T1", true)],
  });
  expect(result.reviewFindings.findings.map((item) => item.kind)).toEqual([
    "finding",
    "adverse-review",
  ]);
  expect(
    evaluate(result, [localAttempt({ subject: subject(12) })]).codes
  ).toContain("blocking-findings");
});

test("ordinary adverse reports whose visible threads are resolved can retain those native resolutions", () => {
  const result = evidence({
    summary: summary({ has_any_findings: true }),
    threads: [thread("T1", true)],
  });
  expect(result.agentReviews[0].verdict).toBe("failed");
  expect(result.reviewFindings.findings.map((item) => item.kind)).toEqual([
    "finding",
  ]);
  expect(
    evaluate(result, [localAttempt({ subject: subject(12) })]).eligible
  ).toBe(true);
});

test.each([false, true])(
  "separate adverse comments retain their own blocker beside resolved governing-summary findings",
  (governingAdverse) => {
    const governing = summary({ has_any_findings: governingAdverse }).summary;
    if (governing === null) {
      throw new Error("expected the fixture summary comment");
    }
    const separate = {
      ...governing,
      body: '<!-- codex-review-state:v2 {"code_review":{"has_any_findings":true}} -->',
      id: 501,
      nativeRef: "https://github.com/example/project/pull/12#issuecomment-501",
      nodeId: "IC_501",
    };
    const observation = parseCodexSummary(
      [governing, separate],
      input().botAccountId
    );
    expect(observation.status).toBe("parsed");
    expect(observation.reportedAdverse).toBe(true);
    const result = evidence({
      summary: observation,
      threads: [thread("T1", true)],
    });
    expect(result.reviewFindings.findings).toHaveLength(2);
    expect(result.reviewFindings.findings[0]?.id).toBe("T1");
    expect(result.reviewFindings.findings[1]?.id).toMatch(
      /^adverse-review:501:2026-01-01T00:10:00Z:[\da-f]{64}$/u
    );
    expect(result.reviewFindings.findings[1]).toMatchObject({
      kind: "adverse-review",
      nativeRef: separate.nativeRef,
      resolution: null,
    });
    const evaluated = evaluate(result, [
      localAttempt({ subject: subject(12) }),
    ]);
    expect(evaluated.eligible).toBe(false);
    expect(evaluated.codes).toContain("blocking-findings");
  }
);

test("active security adverse flags are retained as failed evidence", () => {
  const active = {
    commit_sha: subject(12).headSha,
    has_any_findings: true,
    has_unresolved_findings: true,
    status: "completed",
  };
  const result = evidence({ summary: summary({}, {}, active) });
  expect(result.agentReviews[0].verdict).toBe("failed");
  expect(evaluate(result).codes).toContain("blocking-findings");
});

test("findings survive reviewer disablement and remain blockers after native provenance loses eligibility", () => {
  const result = evidence({ threads: [thread("T1", true)] });
  const policy = policyV2();
  policy.agentReview.reviewers = policy.agentReview.reviewers.filter(
    (item) => item.reviewer !== HOSTED
  );
  expect(
    evaluate(result, [localAttempt({ subject: subject(12) })], policy).codes
  ).toContain("blocking-findings");
});

test("a stale clean report cannot erase a persisted blocker on the current revision", () => {
  const original = finding({ reviewer: HOSTED });
  const result = evidence({
    findings: { findings: [original], recorded: true },
    summary: summary({ commit_sha: "c".repeat(40) }),
  });
  expect(result.agentReviews[0].state).toBe("pending");
  expect(result.observations.summary.state?.codeReview.commitSha).toBe(
    "c".repeat(40)
  );
  expect(result.agentReviews[0].subject).toEqual(subject(12));
  expect(result.reviewFindings.findings).toEqual([original]);
  expect(
    evaluate(result, [localAttempt({ subject: subject(12) })]).codes
  ).toContain("blocking-findings");
});

test("unavailable adverse flags retain a synthetic blocker even alongside visible resolved threads", () => {
  const result = evidence({
    summary: summary({ has_any_findings: true }, { editor: null }),
    threads: [thread("T1", true)],
  });
  expect(result.reviewFindings.findings.map((item) => item.kind)).toEqual([
    "finding",
    "adverse-review",
  ]);
  expect(
    evaluate(result, [localAttempt({ subject: subject(12) })]).codes
  ).toContain("blocking-findings");
  expect(JSON.stringify(result.observations)).not.toContain(
    "private summary prose"
  );
});
