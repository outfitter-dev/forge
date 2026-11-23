import type {
  GateDocument,
  GateEvaluated,
  GateInvalidInput,
  GateNotCollected,
} from "./gate-document.ts";

/** Version 1 retains its original fields for consumers that have not adopted adapter diagnostics. */
export type LegacyGateDocument = { kind: "forge-gate"; schemaVersion: 1 } & (
  | (Omit<GateEvaluated, "reviewAdapters"> & {
      codexReview?: {
        diagnostics: string[];
        findingHistory: "codex-only" | "supplied-global-ledger";
        observations: unknown;
      };
    })
  | GateNotCollected
  | GateInvalidInput
);

export const legacyGateDocument = (
  document: GateDocument
): LegacyGateDocument => {
  if (document.status !== "evaluated") {
    return { ...document, schemaVersion: 1 };
  }
  const { reviewAdapters, ...facts } = document;
  const [adapter] = reviewAdapters?.adapters ?? [];
  const observations = adapter?.observations;
  if (
    reviewAdapters?.adapters.length !== 1 ||
    adapter?.adapter !== "codex-github" ||
    observations === null ||
    typeof observations !== "object" ||
    !Object.hasOwn(observations, "summary")
  ) {
    return { ...facts, schemaVersion: 1 };
  }
  const { findingHistory, ...legacyObservations } = observations as Record<
    string,
    unknown
  >;
  if (
    findingHistory !== "adapter-only" &&
    findingHistory !== "supplied-global-ledger"
  ) {
    return { ...facts, schemaVersion: 1 };
  }
  return {
    ...facts,
    codexReview: {
      diagnostics: adapter.diagnostics,
      findingHistory:
        findingHistory === "adapter-only" ? "codex-only" : findingHistory,
      observations: legacyObservations,
    },
    schemaVersion: 1,
  };
};
