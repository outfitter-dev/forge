import type { CodexReviewEvidenceInput } from "./codex-review-evidence-types.ts";
import type { FindingResolution, ReviewFinding } from "./evidence-types.ts";
import type { GitHubReviewThread } from "./github-pull-request-types.ts";

/** Provider node IDs are durable native references; no discussion URL is inferred. */
const nativeResolution = (
  input: CodexReviewEvidenceInput,
  thread: GitHubReviewThread
): FindingResolution => ({
  kind: "native",
  nativeRef: thread.id,
  provenance: structuredClone(input.issuer),
});

const resolution = (
  input: CodexReviewEvidenceInput,
  finding: ReviewFinding,
  thread: GitHubReviewThread | undefined
): FindingResolution | null => {
  if (thread) {
    if (!thread.isResolved) {
      return null;
    }
    return finding.resolution?.kind === "follow-up-review"
      ? finding.resolution
      : nativeResolution(input, thread);
  }
  return finding.resolution?.kind === "native" ? null : finding.resolution;
};

/** A positive unresolved claim needs a blocker even when every visible thread is resolved. */
const unaccountedAdverse = (
  input: CodexReviewEvidenceInput,
  owned: GitHubReviewThread[]
): boolean => {
  if (!input.summary.reportedAdverse) {
    return false;
  }
  const { state, status } = input.summary;
  return (
    status === "unavailable" ||
    owned.length === 0 ||
    ((state?.codeReview.hasUnresolvedFindings === true ||
      state?.securityReview?.hasUnresolvedFindings === true) &&
      owned.every((thread) => thread.isResolved))
  );
};

/** Updates only the configured reviewer's thread entries. Other origins and detail-less blockers persist. */
export const codexReviewFindings = (
  input: CodexReviewEvidenceInput,
  attemptId: string,
  owned: GitHubReviewThread[]
) => {
  const threads = new Map(owned.map((thread) => [thread.id, thread]));
  const findings = input.findings.findings.map((finding): ReviewFinding => {
    if (
      finding.reviewer !== input.reviewer.reviewer ||
      finding.kind !== "finding"
    ) {
      return finding;
    }
    return {
      ...finding,
      resolution: resolution(input, finding, threads.get(finding.id)),
    };
  });
  const findingIds = owned.map((thread) => thread.id);
  const existing = new Set(
    findings
      .filter((finding) => finding.reviewer === input.reviewer.reviewer)
      .map((finding) => finding.id)
  );
  for (const thread of owned) {
    if (!existing.has(thread.id)) {
      findings.push({
        attemptId,
        id: thread.id,
        kind: "finding",
        nativeRef: thread.id,
        resolution: thread.isResolved ? nativeResolution(input, thread) : null,
        reviewer: input.reviewer.reviewer,
      });
      existing.add(thread.id);
    }
  }
  const adverse = unaccountedAdverse(input, owned);
  if (adverse) {
    for (const comment of input.summary.adverseComments) {
      const id = `adverse-review:${comment.id}`;
      findingIds.push(id);
      if (!existing.has(id)) {
        findings.push({
          attemptId,
          id,
          kind: "adverse-review",
          nativeRef: comment.nativeRef,
          resolution: null,
          reviewer: input.reviewer.reviewer,
        });
        existing.add(id);
      }
    }
  }
  return {
    adverse,
    findingIds,
    ledger: { findings, recorded: input.findingsComplete === true },
  };
};
