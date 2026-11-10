import type {
  EvidenceInput,
  ValidationIssue,
  ValidationResult,
} from "./evidence-types.ts";
import { VERIFICATION_GATES } from "./evidence-types.ts";

class InvalidEvidenceError extends Error {
  readonly issue: ValidationIssue;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "InvalidEvidenceError";
    this.issue = { message, path };
  }
}

const invalid = (path: string, message: string): never => {
  throw new InvalidEvidenceError(path, message);
};

const object = (value: unknown, path: string, keys: string[]) => {
  if (
    value === null ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return invalid(path, "expected a JSON object");
  }
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (!keys.includes(key)) {
      invalid(`${path}.${key}`, "unsupported field");
    }
  }
  return result;
};

const array = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) {
    return invalid(path, "expected an array");
  }
  return value;
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    return invalid(path, "expected a nonempty trimmed string");
  }
  return value;
};

const choice = (value: unknown, path: string, choices: readonly unknown[]) => {
  if (!choices.includes(value)) {
    invalid(path, `expected one of ${choices.join(", ")}`);
  }
};

const count = (value: unknown, path: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(path, "expected a nonnegative safe integer");
  }
};

const digest = (value: unknown, path: string, length: number) => {
  const result = text(value, path);
  if (result.length !== length || !/^[\da-f]+$/u.test(result)) {
    invalid(path, `expected ${length} lowercase hexadecimal characters`);
  }
};

const repository = (value: unknown, path: string) => {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(text(value, path))) {
    invalid(path, "expected an explicit owner/repository identity");
  }
};

const subject = (value: unknown, path: string, kind?: string) => {
  const result = object(value, path, [
    "kind",
    "repository",
    "headSha",
    "baseSha",
    "id",
  ]);
  choice(
    result.kind,
    `${path}.kind`,
    kind ? [kind] : ["pull_request", "merge_group"]
  );
  repository(result.repository, `${path}.repository`);
  digest(result.headSha, `${path}.headSha`, 40);
  digest(result.baseSha, `${path}.baseSha`, 40);
  if (result.kind === "pull_request") {
    count(result.id, `${path}.id`);
    if (result.id === 0) {
      invalid(`${path}.id`, "expected a positive PR number");
    }
  } else if ("id" in result) {
    invalid(`${path}.id`, "a candidate is not a PR");
  }
};

const producer = (value: unknown, path: string, extra: string[] = []) => {
  const result = object(value, path, [
    "producer",
    "runtimeFingerprint",
    ...extra,
  ]);
  text(result.producer, `${path}.producer`);
  digest(result.runtimeFingerprint, `${path}.runtimeFingerprint`, 64);
  return result;
};

const provenance = (value: unknown, path: string) => {
  const result = producer(value, path, ["runId"]);
  text(result.runId, `${path}.runId`);
};

const checks = (value: unknown, path: string) => {
  for (const [index, item] of array(value, path).entries()) {
    const location = `${path}[${index}]`;
    const result = object(item, location, [
      "name",
      "subject",
      "provenance",
      "state",
    ]);
    choice(result.name, `${location}.name`, VERIFICATION_GATES);
    subject(result.subject, `${location}.subject`);
    provenance(result.provenance, `${location}.provenance`);
    choice(result.state, `${location}.state`, [
      "passed",
      "pending",
      "failed",
      "canceled",
      "skipped",
      "incomplete",
      "unknown",
    ]);
  }
};

const agentReviews = (value: unknown, path: string) => {
  for (const [index, item] of array(value, path).entries()) {
    const location = `${path}[${index}]`;
    const result = object(item, location, [
      "provider",
      "subject",
      "provenance",
      "state",
      "complete",
      "verdict",
      "blockingFindings",
    ]);
    choice(result.provider, `${location}.provider`, ["self-hosted", "devin"]);
    subject(result.subject, `${location}.subject`, "pull_request");
    provenance(result.provenance, `${location}.provenance`);
    choice(result.state, `${location}.state`, [
      "completed",
      "pending",
      "failed",
      "canceled",
      "unavailable",
    ]);
    choice(result.complete, `${location}.complete`, [true, false]);
    choice(result.verdict, `${location}.verdict`, [
      "passed",
      "failed",
      "unknown",
    ]);
    if (result.blockingFindings !== null) {
      count(result.blockingFindings, `${location}.blockingFindings`);
    }
  }
};

const pullRequest = (value: unknown, path: string) => {
  const result = object(value, path, [
    "subject",
    "provenance",
    "checks",
    "agentReviews",
    "assignments",
    "humanReviews",
    "open",
    "draft",
    "mergeable",
    "mergeAuthorized",
    "unresolvedThreads",
  ]);
  subject(result.subject, `${path}.subject`, "pull_request");
  provenance(result.provenance, `${path}.provenance`);
  checks(result.checks, `${path}.checks`);
  agentReviews(result.agentReviews, `${path}.agentReviews`);
  const assignments = object(result.assignments, `${path}.assignments`, [
    "recorded",
    "requiredReviewers",
  ]);
  choice(assignments.recorded, `${path}.assignments.recorded`, [true, false]);
  for (const [index, reviewer] of array(
    assignments.requiredReviewers,
    `${path}.assignments.requiredReviewers`
  ).entries()) {
    text(reviewer, `${path}.assignments.requiredReviewers[${index}]`);
  }
  for (const [index, review] of array(
    result.humanReviews,
    `${path}.humanReviews`
  ).entries()) {
    const location = `${path}.humanReviews[${index}]`;
    const human = object(review, location, ["reviewer", "subject", "state"]);
    text(human.reviewer, `${location}.reviewer`);
    if (human.subject !== null) {
      subject(human.subject, `${location}.subject`, "pull_request");
    }
    choice(human.state, `${location}.state`, [
      "approved",
      "changes_requested",
      "dismissed",
      "commented",
      "pending",
    ]);
  }
  for (const key of ["open", "draft", "mergeable", "mergeAuthorized"]) {
    choice(result[key], `${path}.${key}`, [true, false, null]);
  }
  if (result.unresolvedThreads !== null) {
    count(result.unresolvedThreads, `${path}.unresolvedThreads`);
  }
};

const validatePolicy = (value: unknown) => {
  const result = object(value, "policy", [
    "schemaVersion",
    "repository",
    "collector",
    "verification",
    "requiredAgentProviders",
  ]);
  choice(result.schemaVersion, "policy.schemaVersion", [1]);
  repository(result.repository, "policy.repository");
  producer(result.collector, "policy.collector");
  producer(result.verification, "policy.verification");
  const providers = array(
    result.requiredAgentProviders,
    "policy.requiredAgentProviders"
  );
  const seen = new Set<unknown>();
  if (providers.length === 0) {
    invalid(
      "policy.requiredAgentProviders",
      "at least one agent provider is required"
    );
  }
  for (const [index, item] of providers.entries()) {
    const path = `policy.requiredAgentProviders[${index}]`;
    const requirement = producer(item, path, ["provider"]);
    choice(requirement.provider, `${path}.provider`, ["self-hosted", "devin"]);
    if (seen.has(requirement.provider)) {
      invalid(`${path}.provider`, "duplicate required provider");
    }
    seen.add(requirement.provider);
  }
};

const validateFacts = (value: unknown) => {
  const common = ["schemaVersion", "event", "modelAssessment"];
  // Inspect the discriminant before accepting event-specific fields.
  const result = object(value, "facts", [
    ...common,
    "pullRequest",
    "candidate",
    "members",
    "admissions",
  ]);
  choice(result.schemaVersion, "facts.schemaVersion", [1]);
  choice(result.event, "facts.event", ["pull_request", "merge_group"]);
  if ("modelAssessment" in result) {
    const model = object(result.modelAssessment, "facts.modelAssessment", [
      "verdict",
      "explanation",
    ]);
    choice(model.verdict, "facts.modelAssessment.verdict", ["pass", "block"]);
    text(model.explanation, "facts.modelAssessment.explanation");
  }
  if (result.event === "pull_request") {
    object(value, "facts", [...common, "pullRequest"]);
    pullRequest(result.pullRequest, "facts.pullRequest");
    return;
  }
  object(value, "facts", [...common, "candidate", "members", "admissions"]);
  const candidate = object(result.candidate, "facts.candidate", [
    "subject",
    "provenance",
    "checks",
  ]);
  subject(candidate.subject, "facts.candidate.subject", "merge_group");
  provenance(candidate.provenance, "facts.candidate.provenance");
  checks(candidate.checks, "facts.candidate.checks");
  for (const [index, member] of array(
    result.members,
    "facts.members"
  ).entries()) {
    subject(member, `facts.members[${index}]`, "pull_request");
  }
  for (const [index, admission] of array(
    result.admissions,
    "facts.admissions"
  ).entries()) {
    pullRequest(admission, `facts.admissions[${index}]`);
  }
};

/** Validate JSON values and detach them from caller mutation. This is not authentication. */
export const validateEvidenceInput = (
  facts: unknown,
  policy: unknown
): ValidationResult => {
  try {
    // Validate the same detached snapshot that will be evaluated, not a second
    // read of a caller-owned object with potentially changing property values.
    const input = structuredClone({ facts, policy });
    validatePolicy(input.policy);
    validateFacts(input.facts);
    // Both branches and every nested field have been checked above.
    return {
      input: input as EvidenceInput,
      valid: true,
    };
  } catch (error) {
    if (error instanceof InvalidEvidenceError) {
      return { issues: [error.issue], valid: false };
    }
    if (error instanceof Error && error.name === "DataCloneError") {
      return {
        issues: [{ message: "expected cloneable JSON input", path: "input" }],
        valid: false,
      };
    }
    throw error;
  }
};
