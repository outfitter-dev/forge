import { createHash } from "node:crypto";

import type {
  CodexReviewDiagnostic,
  CodexReviewEvidenceInput,
  CodexReviewEvidenceResult,
} from "./codex-review-evidence-types.ts";
import { codexReviewFindings } from "./codex-review-findings.ts";
import type { AgentReviewAttempt } from "./evidence-types.ts";
import {
  choice,
  count,
  digest,
  invalid,
  producer,
  provenance,
  subject,
  text,
} from "./evidence-validation-primitives.ts";
import { parseStoredFindings } from "./review-ledger-findings.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

const instant = (value: string, path: string): number =>
  wholeSecondUtc(value) ?? invalid(path, "expected a whole-second UTC time");

const validInput = (input: CodexReviewEvidenceInput): void => {
  subject(input.subject, "subject", "pull_request");
  provenance(input.issuer, "issuer");
  producer(input.reviewer, "reviewer", ["reviewer", "rung", "waitSeconds"]);
  text(input.reviewer.reviewer, "reviewer.reviewer");
  choice(input.reviewer.rung, "reviewer.rung", ["hosted"]);
  count(input.reviewer.waitSeconds, "reviewer.waitSeconds");
  count(input.botAccountId, "botAccountId");
  if (input.reviewer.waitSeconds === 0 || input.botAccountId === 0) {
    invalid("reviewer", "expected positive wait and bot account ID");
  }
  if (
    input.issuer.producer !== input.reviewer.producer ||
    input.issuer.runtimeFingerprint !== input.reviewer.runtimeFingerprint
  ) {
    invalid(
      "issuer",
      "must match the configured reviewer's producer and runtime"
    );
  }
  if (input.findingsComplete !== undefined) {
    choice(input.findingsComplete, "findingsComplete", [true, false]);
  }
  const served = instant(input.servedAt, "servedAt");
  if (input.snapshot !== null) {
    digest(input.snapshot.headSha, "snapshot.headSha", 40);
    digest(input.snapshot.baseSha, "snapshot.baseSha", 40);
    if (instant(input.snapshot.observedAt, "snapshot.observedAt") > served) {
      invalid("snapshot.observedAt", "cannot follow servedAt");
    }
  }
  if (
    input.summary.reportedAdverse &&
    input.summary.adverseComments.length === 0
  ) {
    invalid(
      "summary.adverseComments",
      "reported adverse evidence requires a source comment"
    );
  }
  const ids = new Set<string>();
  for (const thread of input.threads) {
    text(thread.id, "threads.id");
    choice(thread.isResolved, "threads.isResolved", [true, false]);
    if (ids.has(thread.id)) {
      invalid("threads", "expected unique thread IDs");
    }
    ids.add(thread.id);
  }
};

const attested = (input: CodexReviewEvidenceInput): boolean => {
  const claim = input.attestation;
  if (claim === null) {
    return false;
  }
  text(claim.id, "attestation.id");
  text(claim.policyRevision, "attestation.policyRevision");
  return (
    claim.repository === input.subject.repository &&
    claim.reviewer === input.reviewer.reviewer &&
    claim.botAccountId === input.botAccountId
  );
};

const binding = (
  input: CodexReviewEvidenceInput
): CodexReviewDiagnostic | null => {
  if (input.snapshot === null) {
    return "snapshot-missing";
  }
  if (
    input.snapshot.headSha !== input.subject.headSha ||
    input.snapshot.baseSha !== input.subject.baseSha
  ) {
    return "snapshot-mismatch";
  }
  if (
    input.summary.status !== "parsed" ||
    input.summary.summary === null ||
    input.summary.state === null
  ) {
    return "summary-unavailable";
  }
  if (input.summary.state.codeReview.commitSha !== input.subject.headSha) {
    return "summary-stale";
  }
  const updated = instant(input.summary.summary.updatedAt, "summary.updatedAt");
  if (
    updated <= Date.parse(input.snapshot.observedAt) ||
    updated > Date.parse(input.servedAt)
  ) {
    return "summary-unbound";
  }
  return null;
};

const waiting = (attempt: AgentReviewAttempt): void => {
  if (Date.parse(attempt.observedAt) >= Date.parse(attempt.deadlineAt ?? "")) {
    attempt.state = "unavailable";
    attempt.unavailableReason = "timeout";
  } else {
    attempt.state = "pending";
    attempt.unavailableReason = null;
  }
};

const observationWindow = (input: CodexReviewEvidenceInput) => {
  const startedAt = input.snapshot?.observedAt ?? input.servedAt;
  const deadline = Date.parse(startedAt) + input.reviewer.waitSeconds * 1000;
  if (
    !Number.isSafeInteger(deadline) ||
    !Number.isFinite(new Date(deadline).getTime())
  ) {
    invalid(
      "reviewer.waitSeconds",
      "deadline exceeds the supported time range"
    );
  }
  const deadlineAt = new Date(deadline).toISOString().replace(".000Z", "Z");
  instant(deadlineAt, "deadlineAt");
  const attemptId = `codex/${createHash("sha256")
    .update(
      JSON.stringify([
        input.reviewer.reviewer,
        input.botAccountId,
        input.subject.repository,
        input.subject.id,
        input.subject.headSha,
        input.subject.baseSha,
        startedAt,
        input.issuer.producer,
        input.issuer.runtimeFingerprint,
        input.reviewer.waitSeconds,
        input.attestation?.id ?? null,
        input.attestation?.policyRevision ?? null,
      ])
    )
    .digest("hex")}`;
  return { attemptId, deadlineAt, startedAt };
};

const commentRecord = (
  comment: NonNullable<CodexReviewEvidenceInput["summary"]["summary"]>
) => {
  const { body: _body, ...record } = comment;
  return record;
};

/**
 * Pure normalization of stable collector observations. The caller establishes
 * source trust, pagination, two-pass stability and effective snapshot history,
 * then atomically persists the returned findings before using the evidence.
 */
export const codexReviewEvidence = (
  given: CodexReviewEvidenceInput
): CodexReviewEvidenceResult => {
  const input = structuredClone(given);
  validInput(input);
  try {
    input.findings = parseStoredFindings(input.findings);
  } catch {
    invalid("findings", "expected a valid unique persisted finding ledger");
  }
  const { attemptId, deadlineAt, startedAt } = observationWindow(input);
  const owned = input.threads.filter(
    (thread) =>
      thread.firstAuthor?.id === input.botAccountId &&
      thread.firstAuthor.type === "Bot"
  );
  const findings = codexReviewFindings(input, attemptId, owned);
  const independent = attested(input);
  const diagnostics: CodexReviewDiagnostic[] = [];
  const attempt: AgentReviewAttempt = {
    attemptId,
    complete: false,
    context: independent ? "none" : "unknown",
    deadlineAt,
    findingIds: findings.findingIds,
    harness: null,
    instructions: null,
    kind: "general-review",
    launch: "unknown",
    model: null,
    nativeRef: input.summary.summary?.nativeRef ?? null,
    observedAt: input.servedAt,
    provenance: input.issuer,
    reviewer: input.reviewer.reviewer,
    rung: "hosted",
    startedAt,
    state: "unavailable",
    subject: input.subject,
    unavailableReason: "unknown",
    verdict: "unknown",
  };
  if (!independent) {
    diagnostics.push("independence-unattested");
  }
  if (findings.adverse) {
    diagnostics.push("unaccounted-adverse-report");
  }
  const problem = binding(input);
  if (problem !== null) {
    diagnostics.push(problem);
    if (problem === "summary-stale") {
      waiting(attempt);
    }
  } else if (input.summary.state?.codeReview.status !== "completed") {
    diagnostics.push("summary-not-completed");
    waiting(attempt);
  } else if (!input.summary.cleanCandidate && !input.summary.reportedAdverse) {
    diagnostics.push("security-state-unsupported");
  } else {
    const unresolved = owned.some((thread) => !thread.isResolved);
    if (input.summary.cleanCandidate && unresolved) {
      diagnostics.push("summary-thread-conflict");
    }
    attempt.complete = true;
    attempt.state = "completed";
    attempt.unavailableReason = null;
    attempt.verdict =
      input.summary.reportedAdverse || unresolved ? "failed" : "passed";
  }
  return {
    agentReviews: [attempt],
    diagnostics,
    observations: {
      attestation: input.attestation,
      snapshot: input.snapshot,
      summary: {
        adverseComments: input.summary.adverseComments.map(commentRecord),
        cleanCandidate: input.summary.cleanCandidate,
        comment:
          input.summary.summary === null
            ? null
            : commentRecord(input.summary.summary),
        reason: input.summary.reason,
        reportedAdverse: input.summary.reportedAdverse,
        state: input.summary.state,
        status: input.summary.status,
      },
      threads: [...input.threads],
    },
    reviewFindings: findings.ledger,
    reviewLadder: null,
  };
};
