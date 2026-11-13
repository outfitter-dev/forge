import { expect, test } from "bun:test";

import { followUp, localAttempt } from "./agent-review-fixtures.ts";
import {
  evaluate,
  evidence,
  summary,
  UPDATED,
} from "./codex-review-fixtures.ts";
import { subject } from "./evidence-fixtures.ts";

const resolvedAdverse = () => {
  const observation = summary({ has_any_findings: true });
  const first = evidence({ servedAt: UPDATED, summary: observation });
  const [reported] = first.reviewFindings.findings;
  if (!reported) {
    throw new Error("missing adverse fixture finding");
  }
  const resolved = {
    ...reported,
    resolution: followUp({ subject: subject(12) }),
  };
  const findings = { findings: [resolved], recorded: true };
  const reviewer = localAttempt({
    observedAt: UPDATED,
    startedAt: "2026-01-01T00:09:00Z",
    subject: subject(12),
  });
  expect(
    evaluate(evidence({ findings, summary: observation }), [reviewer]).eligible
  ).toBe(true);
  return { findings, observation, resolved, reviewer };
};

test("a later adverse edit remains blocking after an earlier version's accepted follow-up", () => {
  const previous = resolvedAdverse();
  const result = evidence({
    findings: previous.findings,
    servedAt: "2026-01-01T00:23:00Z",
    summary: summary(
      { has_any_findings: true },
      { updatedAt: "2026-01-01T00:22:00Z" }
    ),
  });
  expect(result.agentReviews[0].verdict).toBe("failed");
  expect(result.reviewFindings.findings).toHaveLength(2);
  expect(result.reviewFindings.findings[0]).toEqual(previous.resolved);
  expect(result.reviewFindings.findings[1]?.resolution).toBeNull();
  expect(result.reviewFindings.findings[1]?.id).not.toBe(previous.resolved.id);
  const decision = evaluate(result, [previous.reviewer]);
  expect(decision.eligible).toBe(false);
  expect(decision.codes).toContain("blocking-findings");
});

test("same-second changed adverse state cannot reuse an accepted resolution", () => {
  const previous = resolvedAdverse();
  const result = evidence({
    findings: previous.findings,
    summary: summary({ has_any_findings: true, has_unresolved_findings: true }),
  });
  expect(result.reviewFindings.findings).toHaveLength(2);
  expect(result.reviewFindings.findings[0]).toEqual(previous.resolved);
  expect(result.reviewFindings.findings[1]?.resolution).toBeNull();
  expect(result.reviewFindings.findings[1]?.id).not.toBe(previous.resolved.id);
  const decision = evaluate(result, [previous.reviewer]);
  expect(decision.eligible).toBe(false);
  expect(decision.codes).toContain("blocking-findings");
});

test("unchanged adverse polls preserve an accepted resolution for that exact version", () => {
  const previous = resolvedAdverse();
  const result = evidence({
    findings: previous.findings,
    servedAt: "2026-01-01T00:12:00Z",
    summary: previous.observation,
  });
  expect(result.reviewFindings).toEqual(previous.findings);
  expect(result.agentReviews[0].findingIds).toEqual([previous.resolved.id]);
  expect(evaluate(result, [previous.reviewer]).eligible).toBe(true);
});

test("a new version's accepted follow-up stays accepted on unchanged later polls", () => {
  const previous = resolvedAdverse();
  const observation = summary(
    { has_any_findings: true },
    { updatedAt: "2026-01-01T00:22:00Z" }
  );
  const edited = evidence({
    findings: previous.findings,
    servedAt: "2026-01-01T00:23:00Z",
    summary: observation,
  });
  const reviewer = localAttempt({
    attemptId: "follow-up/new-adverse-version",
    observedAt: "2026-01-01T00:24:00Z",
    startedAt: "2026-01-01T00:23:00Z",
    subject: subject(12),
  });
  const findings = {
    findings: edited.reviewFindings.findings.map((entry) =>
      entry.id === previous.resolved.id
        ? entry
        : {
            ...entry,
            resolution: followUp({
              attemptId: reviewer.attemptId,
              subject: subject(12),
            }),
          }
    ),
    recorded: true,
  };
  const result = evidence({
    findings,
    servedAt: "2026-01-01T00:25:00Z",
    summary: observation,
  });
  expect(result.reviewFindings).toEqual(findings);
  expect(evaluate(result, [previous.reviewer, reviewer]).eligible).toBe(true);
});

test.each([false, true])(
  "legacy unversioned entries preserve origins and resolutions during conservative reobservation",
  (resolved) => {
    const previous = resolvedAdverse();
    const legacy = {
      ...previous.resolved,
      id: "adverse-review:500",
      resolution: resolved ? previous.resolved.resolution : null,
    };
    const result = evidence({
      findings: { findings: [legacy], recorded: true },
      summary: previous.observation,
    });
    expect(result.reviewFindings.findings).toHaveLength(2);
    expect(result.reviewFindings.findings[0]).toEqual(legacy);
    expect(result.reviewFindings.findings[1]?.id).not.toBe(legacy.id);
    expect(result.reviewFindings.findings[1]?.resolution).toBeNull();
    expect(evaluate(result, [previous.reviewer]).codes).toContain(
      "blocking-findings"
    );
    const repeated = evidence({
      findings: result.reviewFindings,
      summary: previous.observation,
    });
    expect(repeated.reviewFindings).toEqual(result.reviewFindings);
  }
);
