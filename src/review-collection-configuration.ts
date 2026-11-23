import {
  choice,
  count,
  invalid,
  object,
  producer,
  provenance,
  text,
} from "./evidence-validation-primitives.ts";
import { registeredReviewAdapter } from "./review-adapter-registry.ts";
import type {
  ReviewAdapterRegistry,
  ReviewCollectionConfiguration,
} from "./review-collection-types.ts";

/** Validate before source reads. Registry functions are trusted code, never request content. */
export const validateReviewAdapters = (
  entries: ReviewCollectionConfiguration[],
  registry: ReviewAdapterRegistry
): void => {
  const adapters = new Set<string>();
  const reviewers = new Set<string>();
  for (const entry of entries) {
    object(entry, "reviewAdapters", [
      "adapter",
      "reviewer",
      "issuer",
      "configuration",
      "findingsComplete",
    ]);
    text(entry.adapter, "reviewAdapters.adapter");
    const definition =
      registeredReviewAdapter(registry, entry.adapter) ??
      invalid("reviewAdapters.adapter", "expected an installed adapter");
    if (adapters.has(entry.adapter)) {
      invalid("reviewAdapters.adapter", "expected a unique installed adapter");
    }
    const reviewer = producer(entry.reviewer, "reviewAdapters.reviewer", [
      "reviewer",
      "rung",
      "waitSeconds",
    ]);
    text(reviewer.reviewer, "reviewAdapters.reviewer.reviewer");
    choice(reviewer.rung, "reviewAdapters.reviewer.rung", ["hosted", "local"]);
    if (reviewer.rung === "hosted") {
      count(reviewer.waitSeconds, "reviewAdapters.reviewer.waitSeconds");
      if (reviewer.waitSeconds === 0) {
        invalid(
          "reviewAdapters.reviewer.waitSeconds",
          "expected a positive wait"
        );
      }
    }
    if (reviewers.has(entry.reviewer.reviewer)) {
      invalid("reviewAdapters.reviewer", "expected a unique reviewer");
    }
    provenance(entry.issuer, "reviewAdapters.issuer");
    if (
      entry.issuer.producer !== entry.reviewer.producer ||
      entry.issuer.runtimeFingerprint !== entry.reviewer.runtimeFingerprint
    ) {
      invalid("reviewAdapters.issuer", "must match the eligible reviewer");
    }
    choice(entry.findingsComplete, "reviewAdapters.findingsComplete", [
      true,
      false,
    ]);
    definition.validate(structuredClone(entry));
    adapters.add(entry.adapter);
    reviewers.add(entry.reviewer.reviewer);
  }
};
