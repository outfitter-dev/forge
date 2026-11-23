import type { AgentReviewPolicy } from "./evidence-types.ts";
import {
  array,
  invalid,
  object,
  text,
} from "./evidence-validation-primitives.ts";
import type { GatePolicy } from "./gate-policy.ts";
import { reviewAdapterRegistry } from "./review-adapter-registry.ts";
import type {
  GateReviewAdapterPolicy,
  ReviewAdapterRegistry,
} from "./review-collection-types.ts";
import { agentReviewPolicy } from "./validate-agent-review.ts";

/** Policy selects ordered adapters installed by trusted code. */
export const parseGateReviewAdapters = (
  value: unknown,
  evidence: GatePolicy["evidence"],
  registry: ReviewAdapterRegistry = reviewAdapterRegistry
): GateReviewAdapterPolicy[] => {
  const entries = array(value, "gatePolicy.reviewAdapters");
  if (entries.length > 0) {
    agentReviewPolicy(evidence.agentReview, "gatePolicy.evidence.agentReview");
  }
  const adapters = new Set<string>();
  const reviewers = new Set<string>();
  return entries.map((entry, index) => {
    const path = `gatePolicy.reviewAdapters[${index}]`;
    const source = object(entry, path, [
      "adapter",
      "reviewer",
      "configuration",
    ]);
    const adapter = text(source.adapter, `${path}.adapter`);
    const definition = Object.hasOwn(registry, adapter)
      ? registry[adapter]
      : undefined;
    if (definition === undefined) {
      return invalid(`${path}.adapter`, "adapter is not installed");
    }
    if (adapters.has(adapter)) {
      invalid(`${path}.adapter`, "duplicate adapter");
    }
    const reviewer = text(source.reviewer, `${path}.reviewer`);
    if (
      !(evidence.agentReview as AgentReviewPolicy).reviewers.some(
        (candidate) => candidate.reviewer === reviewer
      )
    ) {
      invalid(`${path}.reviewer`, "expected an eligible reviewer");
    }
    if (reviewers.has(reviewer)) {
      invalid(`${path}.reviewer`, "duplicate reviewer");
    }
    adapters.add(adapter);
    reviewers.add(reviewer);
    return {
      adapter,
      configuration: definition.parsePolicy(
        source.configuration,
        reviewer,
        evidence,
        `${path}.configuration`
      ),
      reviewer,
    };
  });
};
