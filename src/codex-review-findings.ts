import { createHash } from "node:crypto";

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
    return nativeResolution(input, thread);
  }
  return finding.resolution?.kind === "native" ? null : finding.resolution;
};

/** A positive unresolved claim needs a blocker even when every visible thread is resolved. */
const unaccountedAdverseComments = (
  input: CodexReviewEvidenceInput,
  owned: GitHubReviewThread[]
) => {
  if (!input.summary.reportedAdverse) {
    return [];
  }
  const { state, status } = input.summary;
  const unaccountedSummary =
    status === "unavailable" ||
    owned.length === 0 ||
    ((state?.codeReview.hasUnresolvedFindings === true ||
      state?.securityReview?.hasUnresolvedFindings === true) &&
      owned.every((thread) => thread.isResolved));
  return input.summary.adverseComments.filter(
    (comment) => comment.id !== input.summary.summary?.id || unaccountedSummary
  );
};

/** Scoped inventory owns canonical origins; attempt IDs refer to those exact versions. */
const scopedReviewFindings = (
  input: CodexReviewEvidenceInput,
  owned: GitHubReviewThread[]
) => {
  const adverseComments = unaccountedAdverseComments(input, owned);
  const findingIds = owned.map((thread) => thread.id);
  for (const comment of adverseComments) {
    const digest = createHash("sha256").update(comment.body).digest("hex");
    const scopedId = `adverse-review:${comment.nodeId}:${comment.updatedAt}:${digest}`;
    const legacyId = `adverse-review:${comment.id}:${comment.updatedAt}:${digest}`;
    const canonical = input.findings.findings.find(
      (finding) =>
        finding.reviewer === input.reviewer.reviewer &&
        finding.nativeRef === comment.nativeRef &&
        (finding.id === scopedId || finding.id === legacyId)
    );
    findingIds.push(canonical?.id ?? scopedId);
  }
  return {
    adverse: adverseComments.length > 0,
    findingIds,
    ledger: structuredClone(input.findings),
  };
};

/** Updates only the configured reviewer's thread entries. Other origins and detail-less blockers persist. */
export const codexReviewFindings = (
  input: CodexReviewEvidenceInput,
  attemptId: string,
  owned: GitHubReviewThread[]
) => {
  if (input.findingSourcesOwnHistory === true) {
    return scopedReviewFindings(input, owned);
  }
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
  const adverseComments = unaccountedAdverseComments(input, owned);
  for (const comment of adverseComments) {
    const digest = createHash("sha256").update(comment.body).digest("hex");
    const id = `adverse-review:${comment.id}:${comment.updatedAt}:${digest}`;
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
  return {
    adverse: adverseComments.length > 0,
    findingIds,
    ledger: { findings, recorded: input.findingsComplete === true },
  };
};
