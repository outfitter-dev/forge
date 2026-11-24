import { parseCodexReviewConfiguration } from "./codex-review-configuration.ts";
import { codexReviewEvidence } from "./codex-review-evidence.ts";
import { parseCodexSummary } from "./codex-summary.ts";
import type { PullRequestCodexReviewConfig } from "./collect-pull-request-types.ts";
import type { AgentReviewPolicy } from "./evidence-types.ts";
import { invalid, count, object } from "./evidence-validation-primitives.ts";
import { parseGateCodexReviewPolicy } from "./gate-codex-policy.ts";
import type { GateCodexReviewPolicy } from "./gate-codex-policy.ts";
import { readIssueComments } from "./github-issue-comments.ts";
import type { GitHubIssueComment } from "./github-pull-request-types.ts";
import type { ReviewAdapterDefinition } from "./review-collection-types.ts";

export const codexReviewAdapter: ReviewAdapterDefinition = {
  configure: (entry, evidence, runId, maxPages, supplied) => {
    const adopted = entry.configuration as GateCodexReviewPolicy;
    const reviewer = (evidence.agentReview as AgentReviewPolicy).reviewers.find(
      (item) => item.reviewer === entry.reviewer
    );
    if (reviewer?.rung !== "hosted") {
      return invalid(
        "gatePolicy.reviewAdapters.reviewer",
        "expected an eligible hosted reviewer"
      );
    }
    return {
      adapter: entry.adapter,
      configuration: {
        attestation:
          adopted.independence === null
            ? null
            : {
                botAccountId: adopted.botAccountId,
                id: adopted.independence.id,
                policyRevision: adopted.independence.policyRevision,
                repository: evidence.repository,
                reviewer: entry.reviewer,
              },
        botAccountId: adopted.botAccountId,
        findingHistory:
          adopted.findingHistory === "codex-only"
            ? "adapter-only"
            : adopted.findingHistory,
        maxCommentPages: maxPages,
      },
      findingsComplete:
        adopted.findingHistory === "codex-only" || supplied?.recorded === true,
      issuer: {
        producer: reviewer.producer,
        runId,
        runtimeFingerprint: reviewer.runtimeFingerprint,
      },
      reviewer,
    };
  },
  normalize: (config, observation, input) => {
    const options = config.configuration as Pick<
      PullRequestCodexReviewConfig,
      "attestation" | "botAccountId"
    >;
    const result = codexReviewEvidence({
      ...options,
      findingSourcesOwnHistory: input.findingSources !== undefined,
      findings: input.findings,
      findingsComplete: config.findingsComplete,
      issuer: config.issuer,
      reviewer: config.reviewer as PullRequestCodexReviewConfig["reviewer"],
      servedAt: input.servedAt,
      snapshot: input.snapshot,
      subject: input.subject,
      summary: parseCodexSummary(
        (observation ?? []) as GitHubIssueComment[],
        options.botAccountId
      ),
      threads: input.reviewThreads,
    });
    const [attempt] = result.agentReviews;
    const malformed =
      result.observations.summary.reason !== null &&
      result.observations.summary.reason !== "summary-missing";
    let state: "passed" | "failed" | "pending" | "unavailable" | "unreadable" =
      malformed ? "unreadable" : "unavailable";
    if (attempt.state === "completed") {
      state = attempt.verdict === "passed" ? "passed" : "failed";
    }
    if (attempt.state === "pending") {
      state = "pending";
    }
    return {
      ...result,
      observations: {
        ...result.observations,
        findingHistory:
          (config.configuration as { findingHistory?: string })
            .findingHistory ?? null,
      },
      state,
    };
  },
  observe: (config, reads) => {
    if (typeof reads.issueComments !== "function") {
      return Promise.reject(new Error("comment-read-missing"));
    }
    const options = config.configuration as { maxCommentPages: number };
    return readIssueComments(
      { issueComments: reads.issueComments.bind(reads) },
      options.maxCommentPages
    );
  },
  parsePolicy: (value, reviewer, evidence, path) => {
    const config = object(value, path, [
      "botAccountId",
      "findingHistory",
      "independence",
    ]);
    if (
      !["adapter-only", "supplied-global-ledger"].includes(
        config.findingHistory as string
      )
    ) {
      invalid(
        `${path}.findingHistory`,
        "expected adapter-only or supplied-global-ledger"
      );
    }
    return parseGateCodexReviewPolicy(
      {
        ...config,
        findingHistory:
          config.findingHistory === "adapter-only"
            ? "codex-only"
            : config.findingHistory,
        reviewer,
      },
      evidence,
      path,
      path.replace(/\.configuration$/u, ".reviewer")
    );
  },
  validate: (config) => {
    const options = object(
      config.configuration,
      "reviewAdapters.configuration",
      ["attestation", "botAccountId", "maxCommentPages", "findingHistory"]
    );
    count(
      options.maxCommentPages,
      "reviewAdapters.configuration.maxCommentPages"
    );
    if (options.maxCommentPages === 0) {
      invalid(
        "reviewAdapters.configuration.maxCommentPages",
        "expected a positive page bound"
      );
    }
    parseCodexReviewConfiguration({
      attestation: options.attestation,
      botAccountId: options.botAccountId,
      issuer: config.issuer,
      reviewer: config.reviewer,
    });
  },
};
