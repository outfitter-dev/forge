import { legacyReviewConfiguration } from "./collect-codex-review.ts";
import type {
  CompatiblePullRequestCollectionRequest,
  PullRequestCommentReads,
} from "./collect-pull-request-types.ts";
import type { ConfiguredFindingInventoryResult } from "./configured-finding-inventory.ts";
import { configuredFindingInventory } from "./configured-finding-inventory.ts";
import type {
  PullRequestSubject,
  ReviewFindingLedger,
} from "./evidence-types.ts";
import { boundFindingReportingSource } from "./finding-source-binding.ts";
import { readFindingObservation } from "./github-finding-observations.ts";
import type {
  FindingObservation,
  PullRequestFindingReads,
} from "./github-finding-observations.ts";
import { GitHubReadError } from "./github-pull-request-reads.ts";
import { GitHubResponseError } from "./github-response.ts";
import type {
  ReviewCollectionResult,
  ReviewObservationInput,
} from "./review-collection-types.ts";
import { identity } from "./review-finding-ledger.ts";
import {
  applyCollectedReviewFollowUps,
  collectedResolutionReviews,
} from "./review-follow-up.ts";
import type { CanonicalReviewLedgerEntry } from "./review-ledger.ts";

export const findingReadCapability = (
  reads: Partial<PullRequestCommentReads & PullRequestFindingReads>
) =>
  typeof reads.scopedReviewThreads === "function" &&
  typeof reads.scopedReviews === "function" &&
  typeof reads.issueComments === "function"
    ? {
        issueComments: reads.issueComments.bind(reads),
        scopedReviewThreads: reads.scopedReviewThreads.bind(reads),
        scopedReviews: reads.scopedReviews.bind(reads),
        ...(typeof reads.scopedThreadComments === "function"
          ? { scopedThreadComments: reads.scopedThreadComments.bind(reads) }
          : {}),
      }
    : null;

/** A bounded source inventory never attests the older global-history policy. */
export const prepareFindingSources = (
  request: CompatiblePullRequestCollectionRequest
): void => {
  if (
    request.findingSources === undefined &&
    request.ledger.reviewFindings?.coverage !== undefined
  ) {
    request.ledger.reviewFindings = {
      findings: request.ledger.reviewFindings.findings,
      recorded: false,
    };
  }
};

/** Refuse a requested collection capability before any authenticated read. */
export const missingCollectionRead = (
  request: CompatiblePullRequestCollectionRequest,
  comments: PullRequestCommentReads | null,
  findingReads: ReturnType<typeof findingReadCapability>
): "comment-read-missing" | "finding-read-missing" | null => {
  if (request.findingSources !== undefined && findingReads === null) {
    return "finding-read-missing";
  }
  return legacyReviewConfiguration(request) !== undefined && comments === null
    ? "comment-read-missing"
    : null;
};

export const readConfiguredFindings = async (
  request: CompatiblePullRequestCollectionRequest,
  reads: ReturnType<typeof findingReadCapability>
): Promise<FindingObservation | null> => {
  if (request.findingSources === undefined || reads === null) {
    return null;
  }
  try {
    return await readFindingObservation(reads, request.maxThreadPages);
  } catch (error) {
    if (
      error instanceof GitHubReadError ||
      error instanceof GitHubResponseError
    ) {
      throw error;
    }
    throw new GitHubReadError("request-failed");
  }
};

/** Only the adopted Codex collector can attest the account behind its legacy origins. */
const legacyCodexSources = (request: CompatiblePullRequestCollectionRequest) =>
  (request.reviewAdapters ?? []).flatMap((entry) => {
    if (entry.adapter !== "codex-github") {
      return [];
    }
    const source = request.findingSources?.sources.find(
      (candidate) =>
        candidate.reviewer === entry.reviewer.reviewer &&
        candidate.accountId ===
          (entry.configuration as { botAccountId: number }).botAccountId
    );
    return source === undefined
      ? []
      : [
          {
            accountId: source.accountId,
            actorType: source.actorType,
            reviewer: source.reviewer,
          },
        ];
  });

/** The independent reviewer supplies attempts; scoped collection owns only finding history. */
export const collectedFindingSources = (
  request: CompatiblePullRequestCollectionRequest,
  first: FindingObservation | null,
  second: FindingObservation | null,
  subject: PullRequestSubject,
  ledger: CanonicalReviewLedgerEntry
) => {
  if (request.findingSources === undefined) {
    return {};
  }
  const result = configuredFindingInventory({
    findings: ledger.reviewFindings,
    first,
    issuer: request.provenance,
    legacyCodexSources: legacyCodexSources(request),
    policy: request.findingSources,
    second,
    subject,
  });
  ledger.reviewFindings = structuredClone(result.reviewFindings);
  return { findingSources: result.coverage };
};

/** Preserve the current source claim while eligible adapters contribute attempts and explicit follow-ups. */
export const retainFindingCoverage = (
  sources: { findingSources?: ConfiguredFindingInventoryResult["coverage"] },
  baseline: ReviewFindingLedger,
  ledger: CanonicalReviewLedgerEntry,
  reviews: { reviewAdapters?: ReviewCollectionResult },
  input: Omit<ReviewObservationInput, "findings">
): void => {
  if (sources.findingSources !== undefined) {
    const {
      diagnostics: _diagnostics,
      recorded,
      ...coverage
    } = sources.findingSources;
    const current = new Map(
      baseline.findings.map((finding) => [
        identity(finding.reviewer, finding.id),
        finding,
      ])
    );
    ledger.reviewFindings = {
      coverage,
      findings: ledger.reviewFindings.findings.map((finding) => {
        const accepted = current.get(identity(finding.reviewer, finding.id));
        return boundFindingReportingSource(finding, coverage) === undefined
          ? finding
          : { ...finding, resolution: accepted?.resolution ?? null };
      }),
      recorded,
    };
  }
  if (reviews.reviewAdapters !== undefined) {
    ledger.reviewFindings = applyCollectedReviewFollowUps(
      reviews.reviewAdapters,
      {
        ...input,
        findings: ledger.reviewFindings,
      }
    );
    reviews.reviewAdapters.reviewFindings = structuredClone(
      ledger.reviewFindings
    );
    const resolutionReviews = collectedResolutionReviews(
      reviews.reviewAdapters,
      {
        ...input,
        findings: ledger.reviewFindings,
      }
    );
    if (resolutionReviews.length > 0) {
      reviews.reviewAdapters.resolutionReviews = resolutionReviews;
    }
  }
};
