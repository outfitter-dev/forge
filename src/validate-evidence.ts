import type {
  EvidenceInput,
  EvidenceInputV2,
  ValidationResult,
} from "./evidence-types.ts";
import { VERIFICATION_GATES } from "./evidence-types.ts";
import {
  array,
  choice,
  count,
  InvalidEvidenceError,
  invalid,
  object,
  producer,
  provenance,
  repository,
  subject,
  text,
} from "./evidence-validation-primitives.ts";
import {
  agentReviewPolicy,
  reviewAttempts,
  reviewFindings,
  reviewLadder,
} from "./validate-agent-review.ts";

type SchemaVersion = 1 | 2;

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

const pullRequest = (value: unknown, path: string, version: SchemaVersion) => {
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
    // Version 1 has no review ledger or ladder; it keeps its original fields.
    ...(version === 2 ? ["reviewFindings", "reviewLadder"] : []),
  ]);
  subject(result.subject, `${path}.subject`, "pull_request");
  provenance(result.provenance, `${path}.provenance`);
  checks(result.checks, `${path}.checks`);
  if (version === 2) {
    reviewAttempts(result.agentReviews, `${path}.agentReviews`);
    reviewFindings(result.reviewFindings, `${path}.reviewFindings`);
    reviewLadder(result.reviewLadder, `${path}.reviewLadder`);
  } else {
    agentReviews(result.agentReviews, `${path}.agentReviews`);
  }
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

const validatePolicy = (value: unknown): SchemaVersion => {
  const common = ["schemaVersion", "repository", "collector", "verification"];
  // Inspect the version before accepting version-specific fields.
  const result = object(value, "policy", [
    ...common,
    "requiredAgentProviders",
    "agentReview",
  ]);
  choice(result.schemaVersion, "policy.schemaVersion", [1, 2]);
  repository(result.repository, "policy.repository");
  producer(result.collector, "policy.collector");
  producer(result.verification, "policy.verification");
  if (result.schemaVersion === 2) {
    object(value, "policy", [...common, "agentReview"]);
    agentReviewPolicy(result.agentReview, "policy.agentReview");
    return 2;
  }
  object(value, "policy", [...common, "requiredAgentProviders"]);
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
  return 1;
};

const validateFacts = (value: unknown, version: SchemaVersion) => {
  const common = ["schemaVersion", "event", "modelAssessment"];
  // Inspect the discriminant before accepting event-specific fields.
  const result = object(value, "facts", [
    ...common,
    "pullRequest",
    "candidate",
    "members",
    "admissions",
  ]);
  choice(result.schemaVersion, "facts.schemaVersion", [1, 2]);
  if (result.schemaVersion !== version) {
    // A record is never read under another version's rules.
    invalid(
      "facts.schemaVersion",
      "facts and policy must use the same schema version"
    );
  }
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
    pullRequest(result.pullRequest, "facts.pullRequest", version);
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
    pullRequest(admission, `facts.admissions[${index}]`, version);
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
    validateFacts(input.facts, validatePolicy(input.policy));
    // Both versions and every nested field have been checked above.
    return {
      input: input as EvidenceInput | EvidenceInputV2,
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
