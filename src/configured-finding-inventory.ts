import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { classifyFindingReport } from "./configured-finding-classification.ts";
import type {
  FindingCoverage,
  Provenance,
  PullRequestSubject,
  ReviewFinding,
  ReviewFindingLedger,
} from "./evidence-types.ts";
import { parseFindingSourcesPolicy } from "./finding-source-policy.ts";
import type {
  FindingSource,
  FindingSourcesPolicy,
} from "./finding-source-policy.ts";
import type {
  FindingObservation,
  FindingReport,
  FindingThread,
} from "./github-finding-observations.ts";
import type { GitHubActor } from "./github-pull-request-types.ts";
import { identity } from "./review-finding-ledger.ts";
import { parseStoredFindings } from "./review-ledger-findings.ts";

export interface ConfiguredFindingInventoryInput {
  policy: FindingSourcesPolicy;
  first: FindingObservation | null;
  second: FindingObservation | null;
  findings: ReviewFindingLedger;
  subject: PullRequestSubject;
  issuer: Provenance;
}

export interface ConfiguredFindingInventoryResult {
  reviewFindings: ReviewFindingLedger;
  coverage: FindingCoverage & { recorded: boolean; diagnostics: string[] };
}

interface Inventory {
  input: ConfiguredFindingInventoryInput;
  policy: FindingSourcesPolicy;
  stable: boolean;
  findings: Map<string, ReviewFinding>;
  diagnostics: Set<string>;
  references: Set<string>;
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const sourceFor = (sources: FindingSource[], actor: GitHubActor | null) =>
  sources.find(
    (source) =>
      actor?.id === source.accountId && actor.type === source.actorType
  );
const trustedEditor = (report: FindingReport, source: FindingSource) =>
  (report.editor === null && report.lastEditedAt === null) ||
  (report.editor?.id === source.accountId &&
    report.editor.type === source.actorType);
const attemptId = (reviewer: string, report: FindingReport) =>
  `configured-report/${reviewer}/${report.nodeId}`;
const put = ({ findings }: Inventory, finding: ReviewFinding) => {
  const key = identity(finding.reviewer, finding.id);
  if (!findings.has(key)) {
    findings.set(key, finding);
  }
};
const reference = ({ references }: Inventory, report: FindingReport) => {
  references.add(
    `${report.surface}:${report.id}:${report.updatedAt}:${digest(report.body)}`
  );
};

const adverseReport = (
  state: Inventory,
  report: FindingReport,
  source: FindingSource | undefined
) => {
  const reviewer =
    source?.reviewer ??
    (report.author === null
      ? "unattributed-github-report"
      : `unconfigured-github-bot/${report.author.id}`);
  put(state, {
    attemptId: attemptId(reviewer, report),
    id: `adverse-review:${report.id}:${report.updatedAt}:${digest(report.body)}`,
    kind: "adverse-review",
    nativeRef: report.nativeRef,
    ...(source === undefined
      ? {}
      : {
          reportingSource: {
            accountId: source.accountId,
            actorType: source.actorType,
          },
        }),
    resolution: null,
    reviewer,
  });
};

const collectReport = (state: Inventory, report: FindingReport) => {
  reference(state, report);
  const source = sourceFor(state.policy.sources, report.author);
  if (!source) {
    if (report.author === null || report.author.type === "Bot") {
      state.diagnostics.add("reporter-identity-unknown");
    }
    if (
      (report.author === null || report.author.type === "Bot") &&
      report.state === "CHANGES_REQUESTED"
    ) {
      adverseReport(state, report, undefined);
    }
    return;
  }
  if (!trustedEditor(report, source)) {
    state.diagnostics.add("report-editor-unverified");
  }
  const classification =
    report.body.trim() === ""
      ? { adverse: report.state === "CHANGES_REQUESTED", known: true }
      : classifyFindingReport(report, source.formats, source.accountId);
  if (!classification.known) {
    state.diagnostics.add("report-format-unknown");
  }
  if (classification.adverse) {
    adverseReport(state, report, source);
  }
};

const collectThread = (state: Inventory, thread: FindingThread) => {
  state.references.add(
    `thread:${thread.id}:${thread.isResolved}:${thread.isOutdated}`
  );
  for (const [index, comment] of thread.comments.entries()) {
    reference(state, comment);
    const source = sourceFor(state.policy.sources, comment.author);
    if (!source) {
      if (comment.author === null || comment.author.type === "Bot") {
        state.diagnostics.add("reporter-identity-unknown");
      }
      continue;
    }
    if (!trustedEditor(comment, source)) {
      state.diagnostics.add("report-editor-unverified");
    }
    if (index !== 0) {
      if (comment.author?.id !== thread.comments[0]?.author?.id) {
        state.diagnostics.add("thread-reply-format-unknown");
      }
      continue;
    }
    if (!source.formats.includes("github-thread-v1")) {
      state.diagnostics.add("thread-format-unknown");
    }
    const key = identity(source.reviewer, thread.id);
    put(state, {
      attemptId: attemptId(source.reviewer, comment),
      id: thread.id,
      kind: "finding",
      nativeRef: thread.id,
      reportingSource: {
        accountId: source.accountId,
        actorType: source.actorType,
      },
      resolution: null,
      reviewer: source.reviewer,
    });
    const existing = state.findings.get(key);
    if (
      existing &&
      existing.reportingSource?.accountId === source.accountId &&
      existing.reportingSource.actorType === source.actorType &&
      state.stable &&
      thread.isResolved &&
      source.formats.includes("github-thread-v1") &&
      trustedEditor(comment, source)
    ) {
      state.findings.set(key, {
        ...existing,
        resolution: {
          kind: "configured-native",
          nativeRef: thread.id,
          policyDigest: state.policy.policyDigest,
          policyRevision: state.policy.policyRevision,
          provenance: structuredClone(state.input.issuer),
        },
      });
    }
  }
};

const collectObservation = (
  state: Inventory,
  observation: FindingObservation | null
) => {
  if (observation === null) {
    return;
  }
  const seen = new Set<string>();
  for (const thread of observation.threads) {
    if (seen.has(`thread:${thread.id}`)) {
      state.diagnostics.add("source-identities-duplicated");
    }
    seen.add(`thread:${thread.id}`);
    collectThread(state, thread);
  }
  for (const report of [...observation.reviews, ...observation.comments]) {
    if (seen.has(`report:${report.id}`)) {
      state.diagnostics.add("source-identities-duplicated");
    }
    seen.add(`report:${report.id}`);
    collectReport(state, report);
  }
};

/** Native thread state and summary text have distinct resolution rules. */
export const configuredFindingInventory = (
  input: ConfiguredFindingInventoryInput
): ConfiguredFindingInventoryResult => {
  const policy = parseFindingSourcesPolicy(input.policy);
  const stable =
    input.first !== null &&
    input.second !== null &&
    isDeepStrictEqual(input.first, input.second);
  const findings = new Map<string, ReviewFinding>(
    parseStoredFindings(input.findings).findings.map((finding) => [
      identity(finding.reviewer, finding.id),
      {
        ...finding,
        // A current native thread observation owns reopening, including after a follow-up.
        resolution:
          finding.resolution?.kind === "configured-native" ||
          finding.resolution?.kind === "native" ||
          (finding.kind === "finding" && finding.reportingSource !== undefined)
            ? null
            : finding.resolution,
      },
    ])
  );
  const state: Inventory = {
    diagnostics: new Set(),
    findings,
    input,
    policy,
    references: new Set(),
    stable,
  };
  if (!stable) {
    state.diagnostics.add("sources-changed-or-missing");
  }
  if (policy.unqualifiedSources.length > 0) {
    state.diagnostics.add("sources-unqualified");
  }
  if (
    policy.sources.some((source) => source.externalCoverage !== "qualified")
  ) {
    state.diagnostics.add("external-coverage-unknown");
  }
  collectObservation(state, input.first);
  collectObservation(state, input.second);
  // Ambiguous reads may retain adverse reports, but cannot clear native blockers.
  if (!stable || state.diagnostics.has("source-identities-duplicated")) {
    for (const [key, finding] of findings) {
      if (finding.resolution?.kind === "configured-native") {
        findings.set(key, { ...finding, resolution: null });
      }
    }
  }
  const coverage: FindingCoverage = {
    policyDigest: policy.policyDigest,
    policyRevision: policy.policyRevision,
    references: [...state.references].toSorted(),
    sourceAccounts: policy.sources.map(
      ({ reviewer, accountId, actorType }) => ({
        accountId,
        actorType,
        reviewer,
      })
    ),
  };
  const recorded = state.diagnostics.size === 0;
  return {
    coverage: {
      ...coverage,
      diagnostics: [...state.diagnostics].toSorted(),
      recorded,
    },
    reviewFindings: { coverage, findings: [...findings.values()], recorded },
  };
};
