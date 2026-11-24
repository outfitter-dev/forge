import { isDeepStrictEqual } from "node:util";

import { bindingProblems, provenanceProblems } from "./evidence-gates.ts";
import type {
  AgentReviewAttempt,
  ReviewFindingLedger,
} from "./evidence-types.ts";
import {
  array,
  choice,
  object,
  text,
} from "./evidence-validation-primitives.ts";
import type {
  ReviewAdapterObservation,
  ReviewCollectionConfiguration,
  ReviewCollectionResult,
  ReviewObservationInput,
} from "./review-collection-types.ts";
import { identity } from "./review-finding-ledger.ts";
import { reviewAttempts } from "./validate-agent-review.ts";

/** A trusted adapter must name the exact accepted origin and the specific follow-up receipt. */
export const validateReviewFollowUps = (
  result: ReviewAdapterObservation
): void => {
  if (result.followUpResolutions === undefined) {
    return;
  }
  reviewAttempts(result.agentReviews, "reviewAdapters.agentReviews");
  for (const [index, value] of array(
    result.followUpResolutions,
    "reviewAdapters.followUpResolutions"
  ).entries()) {
    const path = `reviewAdapters.followUpResolutions[${index}]`;
    const link = object(value, path, [
      "finding",
      "attemptId",
      "disposition",
      "nativeRef",
    ]);
    const finding = object(link.finding, `${path}.finding`, [
      "reviewer",
      "id",
      "attemptId",
      "nativeRef",
    ]);
    for (const key of ["reviewer", "id", "attemptId", "nativeRef"]) {
      text(finding[key], `${path}.finding.${key}`);
    }
    text(link.attemptId, `${path}.attemptId`);
    text(link.nativeRef, `${path}.nativeRef`);
    choice(link.disposition, `${path}.disposition`, ["fixed", "dismissed"]);
  }
};

const qualifiedAttempt = (
  attempt: AgentReviewAttempt,
  entry: ReviewCollectionConfiguration,
  input: ReviewObservationInput
): boolean => {
  const current =
    bindingProblems(attempt.subject, input.subject, "").length === 0;
  const issuer =
    provenanceProblems(attempt.provenance, entry.reviewer, "").length === 0 &&
    attempt.provenance.runId === entry.issuer.runId;
  const completed =
    attempt.state === "completed" &&
    attempt.complete &&
    attempt.verdict !== "unknown" &&
    attempt.findingIds !== null &&
    attempt.nativeRef !== null;
  const independent =
    attempt.context === "none" && attempt.launch === "separate-invocation";
  const deadline =
    entry.reviewer.rung !== "hosted" ||
    (attempt.deadlineAt !== null &&
      Date.parse(attempt.deadlineAt) - Date.parse(attempt.startedAt) ===
        entry.reviewer.waitSeconds * 1000);
  return (
    current &&
    issuer &&
    completed &&
    independent &&
    deadline &&
    attempt.reviewer === entry.reviewer.reviewer &&
    attempt.rung === entry.reviewer.rung
  );
};

/** Called only after both source observations agree. Foreign entries remain immutable except for this explicit resolution. */
export const applyReviewFollowUps = (
  result: ReviewAdapterObservation,
  entry: ReviewCollectionConfiguration,
  input: ReviewObservationInput
): ReviewFindingLedger => {
  const links = result.followUpResolutions ?? [];
  return {
    ...result.reviewFindings,
    findings: result.reviewFindings.findings.map((finding) => {
      const target = {
        attemptId: finding.attemptId,
        id: finding.id,
        nativeRef: finding.nativeRef,
        reviewer: finding.reviewer,
      };
      const matching = links.filter((link) =>
        isDeepStrictEqual(link.finding, target)
      );
      const [link] = matching;
      if (
        finding.kind !== "adverse-review" ||
        finding.reportingSource === undefined ||
        matching.length !== 1 ||
        link === undefined
      ) {
        return finding;
      }
      // A new entry or a changed origin cannot acquire a follow-up through this operation.
      const accepted = input.findings.findings.find(
        (previous) =>
          identity(previous.reviewer, previous.id) ===
          identity(finding.reviewer, finding.id)
      );
      const attempts = result.agentReviews.filter(
        (attempt) => attempt.attemptId === link.attemptId
      );
      const [attempt] = attempts;
      if (
        accepted === undefined ||
        attempts.length !== 1 ||
        attempt === undefined ||
        !qualifiedAttempt(attempt, entry, input) ||
        attempt.attemptId === finding.attemptId
      ) {
        return finding;
      }
      return {
        ...finding,
        resolution: {
          attemptId: attempt.attemptId,
          disposition: link.disposition,
          kind: "follow-up-review" as const,
          nativeRef: link.nativeRef,
          provenance: structuredClone(attempt.provenance),
          subject: structuredClone(attempt.subject),
        },
      };
    }),
  };
};

/** Stable adapter links are reconciled after current native inventory, never on a failed source pass. */
export const applyCollectedReviewFollowUps = (
  collection: ReviewCollectionResult,
  input: ReviewObservationInput
): ReviewFindingLedger => {
  let { findings } = input;
  for (const {
    agentReviews,
    entry,
    links,
    state,
  } of collection.followUpResolutions ?? []) {
    if (state !== "passed" && state !== "failed") {
      continue;
    }
    findings = applyReviewFollowUps(
      {
        agentReviews,
        diagnostics: [],
        followUpResolutions: links,
        observations: null,
        reviewFindings: findings,
        reviewLadder: null,
        state: "passed",
      },
      entry,
      { ...input, findings }
    );
  }
  return findings;
};

/** Keep linked unselected reviews available only for resolving their accepted scoped adverse entries. */
export const collectedResolutionReviews = (
  collection: ReviewCollectionResult,
  input: ReviewObservationInput
): AgentReviewAttempt[] => {
  if (input.findings.coverage === undefined) {
    return [];
  }
  const reviews: AgentReviewAttempt[] = [];
  for (const {
    agentReviews,
    entry,
    links,
    selected,
    state,
  } of collection.followUpResolutions ?? []) {
    if (selected || (state !== "passed" && state !== "failed")) {
      continue;
    }
    for (const attempt of agentReviews) {
      const linked = links.some((link) =>
        input.findings.findings.some((finding) => {
          const { resolution } = finding;
          return (
            finding.kind === "adverse-review" &&
            finding.reportingSource !== undefined &&
            finding.reviewer === link.finding.reviewer &&
            finding.id === link.finding.id &&
            finding.attemptId === link.finding.attemptId &&
            finding.nativeRef === link.finding.nativeRef &&
            resolution?.kind === "follow-up-review" &&
            resolution.attemptId === attempt.attemptId &&
            link.attemptId === attempt.attemptId &&
            resolution.nativeRef === link.nativeRef &&
            isDeepStrictEqual(resolution.provenance, attempt.provenance)
          );
        })
      );
      if (
        linked &&
        qualifiedAttempt(attempt, entry, input) &&
        !reviews.some((known) => isDeepStrictEqual(known, attempt))
      ) {
        reviews.push(structuredClone(attempt));
      }
    }
  }
  return reviews;
};
