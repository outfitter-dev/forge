import type { FindingCoverage, ReviewFinding } from "./evidence-types.ts";

/** Reattribution applies only to one exact immutable Codex origin observed in this collection. */
export const boundFindingReportingSource = (
  finding: ReviewFinding,
  coverage: FindingCoverage | undefined
): ReviewFinding["reportingSource"] => {
  if (finding.reportingSource !== undefined) {
    return finding.reportingSource;
  }
  if (
    !finding.attemptId.startsWith("codex/") ||
    (finding.kind === "finding" && finding.id !== finding.nativeRef)
  ) {
    return undefined;
  }
  const bindings =
    coverage?.legacySources?.filter(
      (entry) =>
        entry.kind === finding.kind &&
        entry.reviewer === finding.reviewer &&
        entry.id === finding.id &&
        entry.attemptId === finding.attemptId &&
        entry.nativeRef === finding.nativeRef
    ) ?? [];
  const [binding] = bindings;
  if (
    bindings.length !== 1 ||
    binding === undefined ||
    !coverage?.sourceAccounts.some(
      (source) =>
        source.reviewer === finding.reviewer &&
        source.accountId === binding.reportingSource.accountId &&
        source.actorType === binding.reportingSource.actorType
    )
  ) {
    return undefined;
  }
  return binding.reportingSource;
};
