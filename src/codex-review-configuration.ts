import type { CodexReviewConfiguration } from "./codex-review-evidence-types.ts";
import {
  choice,
  count,
  invalid,
  object,
  producer,
  provenance,
  repository,
  text,
} from "./evidence-validation-primitives.ts";

/** Validates a caller's explicit configuration. Adoption and source trust remain with that caller. */
export const parseCodexReviewConfiguration = (
  value: unknown
): CodexReviewConfiguration => {
  const source = object(value, "codexReview", [
    "reviewer",
    "issuer",
    "botAccountId",
    "attestation",
  ]);
  const reviewer = producer(source.reviewer, "codexReview.reviewer", [
    "reviewer",
    "rung",
    "waitSeconds",
  ]);
  text(reviewer.reviewer, "codexReview.reviewer.reviewer");
  choice(reviewer.rung, "codexReview.reviewer.rung", ["hosted"]);
  count(reviewer.waitSeconds, "codexReview.reviewer.waitSeconds");
  count(source.botAccountId, "codexReview.botAccountId");
  if (reviewer.waitSeconds === 0 || source.botAccountId === 0) {
    invalid("codexReview", "expected positive wait and bot account ID");
  }
  provenance(source.issuer, "codexReview.issuer");
  const issuer = source.issuer as CodexReviewConfiguration["issuer"];
  if (
    issuer.producer !== reviewer.producer ||
    issuer.runtimeFingerprint !== reviewer.runtimeFingerprint
  ) {
    invalid(
      "codexReview.issuer",
      "must match the configured reviewer's producer and runtime"
    );
  }
  if (source.attestation !== null) {
    const claim = object(source.attestation, "codexReview.attestation", [
      "id",
      "policyRevision",
      "repository",
      "reviewer",
      "botAccountId",
    ]);
    text(claim.id, "codexReview.attestation.id");
    text(claim.policyRevision, "codexReview.attestation.policyRevision");
    repository(claim.repository, "codexReview.attestation.repository");
    text(claim.reviewer, "codexReview.attestation.reviewer");
    count(claim.botAccountId, "codexReview.attestation.botAccountId");
    if (claim.botAccountId === 0) {
      invalid(
        "codexReview.attestation.botAccountId",
        "expected a positive account ID"
      );
    }
  }
  return structuredClone(source) as unknown as CodexReviewConfiguration;
};
