import type { CodexReviewEvidenceResult } from "./codex-review-evidence-types.ts";
import { codexReviewEvidence } from "./codex-review-evidence.ts";
import { parseCodexSummary } from "./codex-summary.ts";
import type {
  PullRequestCodexReviewConfig,
  PullRequestCommentReads,
} from "./collect-pull-request-types.ts";
import type { PullRequestSubject } from "./evidence-types.ts";
import { readIssueComments } from "./github-issue-comments.ts";
import type {
  GitHubIssueComment,
  GitHubReviewThread,
} from "./github-pull-request-types.ts";
import type { CanonicalReviewLedgerEntry } from "./review-ledger.ts";

/** Capture one capability before awaiting reads so the caller cannot swap it during collection. */
export const commentReadCapability = (
  reads: Partial<PullRequestCommentReads>
): PullRequestCommentReads | null =>
  typeof reads.issueComments === "function"
    ? { issueComments: reads.issueComments.bind(reads) }
    : null;

/** Disabled collection performs no comment read. Capability availability is checked before the first read. */
export const readCollectionComments = (
  config: PullRequestCodexReviewConfig | undefined,
  reads: PullRequestCommentReads | null
): Promise<GitHubIssueComment[] | null> =>
  config && reads
    ? readIssueComments(reads, config.maxCommentPages)
    : Promise.resolve(null);

/** Runs only after every configured source agrees across both complete passes. */
export const collectedCodexReview = (
  config: PullRequestCodexReviewConfig | undefined,
  comments: GitHubIssueComment[] | null,
  input: {
    subject: PullRequestSubject;
    servedAt: string;
    ledger: CanonicalReviewLedgerEntry;
    reviewThreads: GitHubReviewThread[];
  }
): CodexReviewEvidenceResult | undefined => {
  if (config === undefined || comments === null) {
    return undefined;
  }
  return codexReviewEvidence({
    attestation: config.attestation,
    botAccountId: config.botAccountId,
    findings: input.ledger.reviewFindings,
    findingsComplete: config.findingsComplete === true,
    issuer: config.issuer,
    reviewer: config.reviewer,
    servedAt: input.servedAt,
    snapshot: input.ledger.observedRevision,
    subject: input.subject,
    summary: parseCodexSummary(comments, config.botAccountId),
    threads: input.reviewThreads,
  });
};
