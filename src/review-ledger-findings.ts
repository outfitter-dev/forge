import { isDeepStrictEqual } from "node:util";

import type { ReviewFinding, ReviewFindingLedger } from "./evidence-types.ts";
import { invalid, object } from "./evidence-validation-primitives.ts";
import { identity } from "./review-finding-ledger.ts";
import { reviewFindings } from "./validate-agent-review.ts";

/** Hidden fields cannot survive JSON publication, so they cannot be accepted ledger state. */
const enumerableJson = (value: unknown): void => {
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) {
      invalid("reviewFindings", "expected only array elements");
    }
    for (const item of value) {
      enumerableJson(item);
    }
  } else if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    object(value, "reviewFindings", keys);
    if (Reflect.ownKeys(value).length !== keys.length) {
      invalid("reviewFindings", "expected plain enumerable fields");
    }
    for (const item of Object.values(value)) {
      enumerableJson(item);
    }
  }
};

/** Reuses evaluator shape rules, adding the store's uniqueness and serialization requirements. */
export const parseStoredFindings = (value: unknown): ReviewFindingLedger => {
  reviewFindings(value, "reviewFindings");
  enumerableJson(value);
  const ledger = value as ReviewFindingLedger;
  const seen = new Set<string>();
  for (const finding of ledger.findings) {
    const key = identity(finding.reviewer, finding.id);
    if (seen.has(key)) {
      invalid("reviewFindings", "expected unique reviewer and finding IDs");
    }
    seen.add(key);
  }
  return structuredClone(ledger);
};

const origin = ({ resolution: _resolution, ...finding }: ReviewFinding) =>
  finding;

/** Accepted findings keep their original identity and reporting source across updates. */
export const retainsFindings = (
  before: ReviewFindingLedger,
  after: ReviewFindingLedger
): boolean =>
  before.findings.every((finding) =>
    after.findings.some((next) =>
      isDeepStrictEqual(origin(finding), origin(next))
    )
  );

/**
 * Supplied evidence may add blockers but cannot replace a persisted entry's resolution.
 * Conflicting or repeated entries stay duplicated for the evaluator to reject.
 */
export const gateReviewFindings = (
  persisted: ReviewFindingLedger,
  supplied: unknown
): unknown => {
  if (!persisted.recorded && persisted.findings.length === 0) {
    return supplied;
  }
  try {
    reviewFindings(supplied, "facts.pullRequest.reviewFindings");
  } catch {
    // Preserve malformed evidence for the evaluator's usual invalid-input response.
    return supplied;
  }
  const external = supplied as ReviewFindingLedger;
  const unmatched = [...persisted.findings];
  const findings = [...persisted.findings];
  for (const finding of external.findings) {
    const match = unmatched.findIndex((known) =>
      isDeepStrictEqual(known, finding)
    );
    if (match === -1) {
      findings.push(finding);
    } else {
      unmatched.splice(match, 1);
    }
  }
  return { findings, recorded: persisted.recorded && external.recorded };
};
