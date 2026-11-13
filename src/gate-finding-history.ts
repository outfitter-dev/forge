import { isDeepStrictEqual } from "node:util";

import type { ReviewFindingLedger } from "./evidence-types.ts";
import type { ReviewEvidence } from "./gate-inputs.ts";
import { identity } from "./review-finding-ledger.ts";
import { parseStoredFindings } from "./review-ledger-findings.ts";

/** Only well-formed, unique history is accepted for persistence and source-completeness claims. */
export const acceptedFindingHistory = (
  supplied: ReviewEvidence | null
): ReviewFindingLedger | null => {
  if (supplied === null) {
    return null;
  }
  try {
    return parseStoredFindings(supplied.reviewFindings);
  } catch {
    // The original content still reaches the evaluator's invalid/duplicate-evidence path.
    return null;
  }
};

/** External evidence can add or reopen blockers, never rewrite an accepted origin or clear its blocker. */
export const ingestFindingHistory = (
  collected: ReviewFindingLedger,
  supplied: ReviewFindingLedger | null
): ReviewFindingLedger => {
  if (supplied === null) {
    return collected;
  }
  const findings = new Map(
    collected.findings.map((finding) => [
      identity(finding.reviewer, finding.id),
      finding,
    ])
  );
  for (const incoming of supplied.findings) {
    const key = identity(incoming.reviewer, incoming.id);
    const current = findings.get(key);
    if (current === undefined) {
      findings.set(key, structuredClone(incoming));
    } else if (!isDeepStrictEqual(current, incoming)) {
      findings.set(key, { ...current, resolution: null });
    }
  }
  return { findings: [...findings.values()], recorded: supplied.recorded };
};
