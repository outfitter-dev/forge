import { codexReviewAdapter } from "./codex-review-adapter.ts";
import type { ReviewAdapterRegistry } from "./review-collection-types.ts";

/** Trusted code chooses registrations. A policy can only name an installed adapter. */
export const reviewAdapterRegistry: ReviewAdapterRegistry = {
  "codex-github": codexReviewAdapter,
};

/** Prototype properties never register an adapter. */
export const registeredReviewAdapter = (
  registry: ReviewAdapterRegistry,
  id: string
) => (Object.hasOwn(registry, id) ? registry[id] : undefined);

/** Capture callable capabilities before awaiting inputs or source reads. */
export const captureReviewAdapterRegistry = (
  registry: ReviewAdapterRegistry
): ReviewAdapterRegistry =>
  Object.fromEntries(
    Object.entries(registry).map(([id, definition]) => [
      id,
      {
        configure: definition.configure.bind(definition),
        normalize: definition.normalize.bind(definition),
        observe: definition.observe.bind(definition),
        parsePolicy: definition.parsePolicy.bind(definition),
        validate: definition.validate.bind(definition),
      },
    ])
  );
