import type {
  EvidencePolicy,
  MergeGroupFacts,
  Provenance,
  PullRequestEvidence,
  PullRequestFacts,
  PullRequestSubject,
} from "../src/index.ts";
import { VERIFICATION_GATES } from "../src/index.ts";

export const REPOSITORY = "example/project";
export const HEAD = "a".repeat(40);
export const BASE = "b".repeat(40);

export const at = <T>(items: T[], index = 0): T => {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`missing fixture item ${index}`);
  }
  return value;
};

export const provenance = (
  role: "collector" | "verification" | "agent"
): Provenance => ({
  producer: `${role}:fixture`,
  runId: "offline-run-1",
  runtimeFingerprint: { agent: "3", collector: "1", verification: "2" }[
    role
  ].repeat(64),
});

export const policy = (): EvidencePolicy => ({
  collector: {
    producer: "collector:fixture",
    runtimeFingerprint: "1".repeat(64),
  },
  repository: REPOSITORY,
  requiredAgentProviders: [
    {
      producer: "agent:fixture",
      provider: "self-hosted",
      runtimeFingerprint: "3".repeat(64),
    },
  ],
  schemaVersion: 1,
  verification: {
    producer: "verification:fixture",
    runtimeFingerprint: "2".repeat(64),
  },
});

export const subject = (
  id = 1,
  headSha = HEAD,
  baseSha = BASE
): PullRequestSubject => ({
  baseSha,
  headSha,
  id,
  kind: "pull_request",
  repository: REPOSITORY,
});

export const passingPr = (
  id = 1,
  headSha = HEAD,
  baseSha = BASE
): PullRequestEvidence => ({
  agentReviews: [
    {
      blockingFindings: 0,
      complete: true,
      provenance: provenance("agent"),
      provider: "self-hosted",
      state: "completed",
      subject: subject(id, headSha, baseSha),
      verdict: "passed",
    },
  ],
  assignments: { recorded: true, requiredReviewers: [] },
  checks: VERIFICATION_GATES.map((name) => ({
    name,
    provenance: provenance("verification"),
    state: "passed",
    subject: subject(id, headSha, baseSha),
  })),
  draft: false,
  humanReviews: [],
  mergeAuthorized: true,
  mergeable: true,
  open: true,
  provenance: provenance("collector"),
  subject: subject(id, headSha, baseSha),
  unresolvedThreads: 0,
});

export const passingFacts = (): PullRequestFacts => ({
  event: "pull_request",
  pullRequest: passingPr(),
  schemaVersion: 1,
});

export const passingGroup = (): MergeGroupFacts => {
  const candidate = {
    baseSha: BASE,
    headSha: "c".repeat(40),
    kind: "merge_group" as const,
    repository: REPOSITORY,
  };
  return {
    admissions: [passingPr()],
    candidate: {
      checks: VERIFICATION_GATES.map((name) => ({
        name,
        provenance: provenance("verification"),
        state: "passed",
        subject: { ...candidate },
      })),
      provenance: provenance("collector"),
      subject: candidate,
    },
    event: "merge_group",
    members: [subject()],
    schemaVersion: 1,
  };
};
