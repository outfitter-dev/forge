import { fullCommit } from "./buildkite-job.ts";
import type {
  GateDocument,
  GateEvaluated,
  GateNotCollected,
  GateInvalidInput,
} from "./gate-document.ts";
import type { GitHubPullRequest } from "./github-pull-request-types.ts";
import { isRecord } from "./github-response.ts";

/** Version 1 status facts retain their meaning. Only version 2 carries neutral adapter diagnostics. */
export type GateStatusDocument =
  | GateDocument
  | ({ kind: "forge-gate"; schemaVersion: 1 } & (
      | GateEvaluated
      | GateNotCollected
      | GateInvalidInput
    ));

interface RefreshTarget {
  repository: string;
  pullRequest: number;
}

interface RefreshPolicy {
  repository: string;
  holdLabel: string;
}

const VALID_REPOSITORY = /^[\w.-]+\/[\w.-]+$/u;
const VALID_LABEL = /^[!-~](?:[ -~]*[!-~])?$/u;
/** Shared validation before refresh selection, preview or publication effects. */
export const validBuildkiteStatusRefreshPolicy = (policy: RefreshPolicy) =>
  VALID_REPOSITORY.test(policy.repository) &&
  VALID_LABEL.test(policy.holdLabel);

const sameName = (left: string, right: string) =>
  left.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase()) ===
  right.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());

const pullNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const refreshAction = (
  event: string,
  payload: Record<string, unknown>,
  holdLabel: string
) => {
  const { action, label } = payload;
  switch (event) {
    case "pull_request": {
      return (
        (action === "labeled" || action === "unlabeled") &&
        isRecord(label) &&
        typeof label.name === "string" &&
        sameName(label.name, holdLabel)
      );
    }
    case "pull_request_review": {
      return action === "submitted" || action === "dismissed";
    }
    case "pull_request_review_thread": {
      return action === "resolved" || action === "unresolved";
    }
    default: {
      return false;
    }
  }
};

/** An adapter must authenticate delivery. The payload only names a PR to reread. */
export const selectBuildkiteStatusRefresh = (
  event: string,
  payload: unknown,
  policy: RefreshPolicy
): RefreshTarget | null => {
  if (
    !validBuildkiteStatusRefreshPolicy(policy) ||
    !isRecord(payload) ||
    !isRecord(payload.repository) ||
    typeof payload.repository.full_name !== "string" ||
    !sameName(payload.repository.full_name, policy.repository) ||
    !refreshAction(event, payload, policy.holdLabel)
  ) {
    return null;
  }
  const pull = payload.pull_request;
  if (!isRecord(pull) || !pullNumber(pull.number)) {
    return null;
  }
  return { pullRequest: pull.number, repository: policy.repository };
};

type RefreshSubject = GateEvaluated["subject"];

const subjectOf = (
  target: RefreshTarget,
  pull: GitHubPullRequest | null
): RefreshSubject | null => {
  if (
    !pull ||
    !pullNumber(target.pullRequest) ||
    pull.number !== target.pullRequest ||
    pull.state !== "open" ||
    pull.merged !== false ||
    !sameName(target.repository, pull.base.repositoryName) ||
    pull.head.repositoryId !== pull.base.repositoryId ||
    !fullCommit(pull.head.sha) ||
    !fullCommit(pull.base.sha)
  ) {
    return null;
  }
  return { ...target, baseSha: pull.base.sha, headSha: pull.head.sha };
};

const sameSubject = (left: RefreshSubject, right: RefreshSubject) =>
  left.repository === right.repository &&
  left.pullRequest === right.pullRequest &&
  left.headSha === right.headSha &&
  left.baseSha === right.baseSha;

const gateMatches = (
  gate: GateEvaluated,
  subject: RefreshSubject,
  current: GitHubPullRequest,
  holdLabel: string
) => {
  const { facts } = gate.evaluation.input;
  if (facts.event !== "pull_request" || !facts.pullRequest.open) {
    return false;
  }
  const evaluated = facts.pullRequest.subject;
  const held = current.labels.some((label) => sameName(label.name, holdLabel));
  return (
    sameSubject(gate.subject, subject) &&
    sameSubject({ ...evaluated, pullRequest: evaluated.id }, subject) &&
    facts.pullRequest.mergeAuthorized === !held &&
    facts.pullRequest.draft === current.draft &&
    facts.pullRequest.mergeable === current.mergeable &&
    gate.eligible === gate.evaluation.eligible
  );
};

type RefreshPreview =
  | {
      status: "preview";
      eligible: boolean;
      subject: RefreshSubject;
    }
  | {
      status: "withheld";
      reason:
        | "admission-refused"
        | "revision-changed"
        | "gate-unavailable"
        | "gate-mismatch";
    };

/**
 * Only previews a fresh trusted gate run for the same, still-open revision pair.
 * Neither the event nor a stale result can supply eligibility or select a SHA.
 */
export const previewBuildkiteStatusRefresh = ({
  policy,
  target,
  admitted,
  current,
  runId,
  gate,
}: {
  policy: RefreshPolicy;
  target: RefreshTarget;
  /** Trusted PR read before the run, not the webhook payload. */
  admitted: GitHubPullRequest | null;
  /** Trusted PR reread after the run. */
  current: GitHubPullRequest | null;
  /** New trusted identifier for this evaluation, never a delivery field. */
  runId: string;
  /** The verified install's gate result, with qualified project evidence. */
  gate: GateStatusDocument | null;
}): RefreshPreview => {
  const subject = subjectOf(target, admitted);
  if (
    subject === null ||
    target.repository !== policy.repository ||
    !validBuildkiteStatusRefreshPolicy(policy)
  ) {
    return { reason: "admission-refused", status: "withheld" };
  }
  const latest = subjectOf(target, current);
  if (
    !admitted ||
    !current ||
    latest === null ||
    current.base.repositoryId !== admitted.base.repositoryId ||
    !sameSubject(subject, latest)
  ) {
    return { reason: "revision-changed", status: "withheld" };
  }
  if (
    gate?.kind !== "forge-gate" ||
    (gate.schemaVersion !== 1 && gate.schemaVersion !== 2) ||
    gate.status !== "evaluated"
  ) {
    return { reason: "gate-unavailable", status: "withheld" };
  }
  if (
    !runId ||
    gate.runId !== runId ||
    !gateMatches(gate, subject, current, policy.holdLabel)
  ) {
    return { reason: "gate-mismatch", status: "withheld" };
  }
  return { eligible: gate.eligible, status: "preview", subject };
};
