import { choice, invalid } from "./evidence-validation-primitives.ts";
import { registeredReviewAdapter } from "./review-adapter-registry.ts";
import { collectReviewAdapter } from "./review-adapter.ts";
import type {
  ReviewAdapterRegistry,
  ReviewCollectionConfiguration,
  ReviewObservationInput,
  ReviewAdapterObservation,
} from "./review-collection-types.ts";
import { validateReviewFollowUps } from "./review-follow-up.ts";

/** Normalize only facts owned by this adapter, retaining a durable blocker for a detail-less failed verdict. */
export const normalizeReviewObservation = (
  entry: ReviewCollectionConfiguration,
  observation: unknown,
  input: ReviewObservationInput,
  registry: ReviewAdapterRegistry
): ReviewAdapterObservation | undefined => {
  try {
    const definition =
      registeredReviewAdapter(registry, entry.adapter) ??
      invalid("reviewAdapters.adapter", "adapter is not installed");
    const result = collectReviewAdapter(
      {
        collect: (stable) =>
          definition.normalize(structuredClone(entry), observation, {
            ...input,
            ...stable,
          }),
        reviewer: entry.reviewer.reviewer,
      },
      input
    );
    const adverse = result.agentReviews.filter(
      (attempt) => attempt.state === "completed" && attempt.verdict === "failed"
    );
    for (const attempt of adverse) {
      if (
        result.reviewFindings.findings.some(
          (finding) =>
            finding.reviewer === entry.reviewer.reviewer &&
            attempt.findingIds?.includes(finding.id) === true
        )
      ) {
        continue;
      }
      if (attempt.nativeRef === null) {
        return undefined;
      }
      const id = `adverse-review:${attempt.attemptId}`;
      result.reviewFindings.findings.push({
        attemptId: attempt.attemptId,
        id,
        kind: "adverse-review",
        nativeRef: attempt.nativeRef,
        resolution: null,
        reviewer: entry.reviewer.reviewer,
      });
      attempt.findingIds = [...(attempt.findingIds ?? []), id];
    }
    choice(result.state, "reviewAdapters.state", [
      "passed",
      "failed",
      "pending",
      "unavailable",
      "unreadable",
    ]);
    validateReviewFollowUps(result);
    return result;
  } catch {
    return undefined;
  }
};
