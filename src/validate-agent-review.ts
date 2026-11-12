import {
  array,
  choice,
  count,
  digest,
  invalid,
  object,
  producer,
  provenance,
  subject,
  text,
} from "./evidence-validation-primitives.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

const RUNGS = ["hosted", "local"];

const instructions = (value: unknown, path: string) => {
  const result = object(value, path, ["id", "digest"]);
  text(result.id, `${path}.id`);
  digest(result.digest, `${path}.digest`, 64);
};

/** One precision keeps `deadlineAt === startedAt + waitSeconds` exact. */
const instant = (value: unknown, path: string): number => {
  const time = wholeSecondUtc(text(value, path));
  if (time === null) {
    return invalid(
      path,
      "expected a whole-second UTC time like 2026-01-01T00:00:00Z"
    );
  }
  return time;
};

const attempt = (value: unknown, path: string) => {
  const result = object(value, path, [
    "kind",
    "attemptId",
    "rung",
    "reviewer",
    "subject",
    "provenance",
    "model",
    "harness",
    "instructions",
    "launch",
    "context",
    "startedAt",
    "deadlineAt",
    "observedAt",
    "state",
    "unavailableReason",
    "complete",
    "verdict",
    "findingIds",
    "nativeRef",
  ]);
  if (result.kind !== "general-review") {
    // Tenet shadow evidence is a separate contract with no slot in this gate.
    invalid(`${path}.kind`, "expected general-review evidence");
  }
  text(result.attemptId, `${path}.attemptId`);
  choice(result.rung, `${path}.rung`, RUNGS);
  text(result.reviewer, `${path}.reviewer`);
  subject(result.subject, `${path}.subject`, "pull_request");
  provenance(result.provenance, `${path}.provenance`);
  for (const key of ["model", "harness", "nativeRef"]) {
    if (result[key] !== null) {
      text(result[key], `${path}.${key}`);
    }
  }
  if (result.instructions !== null) {
    instructions(result.instructions, `${path}.instructions`);
  }
  choice(result.launch, `${path}.launch`, [
    "separate-invocation",
    "author-subagent",
    "unknown",
  ]);
  choice(result.context, `${path}.context`, ["none", "inherited", "unknown"]);
  const started = instant(result.startedAt, `${path}.startedAt`);
  const observed = instant(result.observedAt, `${path}.observedAt`);
  if (observed < started) {
    invalid(`${path}.observedAt`, "observation cannot precede startedAt");
  }
  const deadline =
    result.deadlineAt === null
      ? null
      : instant(result.deadlineAt, `${path}.deadlineAt`);
  if (deadline === null ? result.rung === "hosted" : deadline <= started) {
    invalid(
      `${path}.deadlineAt`,
      "expected a deadline after startedAt; hosted attempts require one"
    );
  }
  choice(result.state, `${path}.state`, [
    "completed",
    "pending",
    "failed",
    "canceled",
    "unavailable",
  ]);
  choice(
    result.unavailableReason,
    `${path}.unavailableReason`,
    result.state === "unavailable"
      ? ["rate-limit", "error", "timeout", "unknown"]
      : [null]
  );
  if (
    result.unavailableReason === "timeout" &&
    (deadline === null || observed < deadline)
  ) {
    invalid(
      `${path}.unavailableReason`,
      "a timeout requires a deadline that observedAt has reached"
    );
  }
  choice(result.complete, `${path}.complete`, [true, false]);
  choice(result.verdict, `${path}.verdict`, ["passed", "failed", "unknown"]);
  const findingIds =
    result.findingIds === null
      ? []
      : array(result.findingIds, `${path}.findingIds`);
  for (const [index, id] of findingIds.entries()) {
    text(id, `${path}.findingIds[${index}]`);
  }
  if (result.verdict === "failed" && findingIds.length === 0) {
    // Without a ledger entry, dropping this attempt would erase its verdict.
    invalid(
      `${path}.findingIds`,
      "a failed verdict must reference at least one ledger entry"
    );
  }
};

export const reviewAttempts = (value: unknown, path: string) => {
  for (const [index, item] of array(value, path).entries()) {
    attempt(item, `${path}[${index}]`);
  }
};

const resolution = (value: unknown, path: string) => {
  const common = ["kind", "provenance", "nativeRef"];
  const result = object(value, path, [
    ...common,
    "subject",
    "attemptId",
    "disposition",
  ]);
  choice(result.kind, `${path}.kind`, ["native", "follow-up-review"]);
  if (result.kind === "native") {
    object(value, path, common);
  } else {
    subject(result.subject, `${path}.subject`, "pull_request");
    text(result.attemptId, `${path}.attemptId`);
    choice(result.disposition, `${path}.disposition`, ["fixed", "dismissed"]);
  }
  provenance(result.provenance, `${path}.provenance`);
  text(result.nativeRef, `${path}.nativeRef`);
};

export const reviewFindings = (value: unknown, path: string) => {
  const ledger = object(value, path, ["recorded", "findings"]);
  choice(ledger.recorded, `${path}.recorded`, [true, false]);
  for (const [index, item] of array(
    ledger.findings,
    `${path}.findings`
  ).entries()) {
    const location = `${path}.findings[${index}]`;
    const finding = object(item, location, [
      "kind",
      "reviewer",
      "id",
      "attemptId",
      "nativeRef",
      "resolution",
    ]);
    choice(finding.kind, `${location}.kind`, ["finding", "adverse-review"]);
    for (const key of ["reviewer", "id", "attemptId", "nativeRef"]) {
      text(finding[key], `${location}.${key}`);
    }
    if (finding.resolution !== null) {
      resolution(finding.resolution, `${location}.resolution`);
    }
  }
};

export const reviewLadder = (value: unknown, path: string) => {
  if (value === null) {
    return;
  }
  const ladder = object(value, path, ["subject", "provenance", "exhausted"]);
  subject(ladder.subject, `${path}.subject`, "pull_request");
  provenance(ladder.provenance, `${path}.provenance`);
  choice(ladder.exhausted, `${path}.exhausted`, [true, false]);
};

export const agentReviewPolicy = (value: unknown, path: string) => {
  const result = object(value, path, ["reviewers", "instructions", "ladder"]);
  const reviewers = array(result.reviewers, `${path}.reviewers`);
  if (reviewers.length === 0) {
    invalid(`${path}.reviewers`, "at least one eligible reviewer is required");
  }
  const seen = new Set<unknown>();
  let local = false;
  for (const [index, item] of reviewers.entries()) {
    const location = `${path}.reviewers[${index}]`;
    const reviewer = producer(item, location, [
      "reviewer",
      "rung",
      "waitSeconds",
    ]);
    text(reviewer.reviewer, `${location}.reviewer`);
    choice(reviewer.rung, `${location}.rung`, RUNGS);
    if (reviewer.rung === "hosted") {
      // Consumer-configured and finite: there is no default wait.
      count(reviewer.waitSeconds, `${location}.waitSeconds`);
      if (reviewer.waitSeconds === 0) {
        invalid(`${location}.waitSeconds`, "expected a positive wait");
      }
    } else {
      local = true;
      if ("waitSeconds" in reviewer) {
        invalid(`${location}.waitSeconds`, "only hosted reviewers wait");
      }
    }
    if (seen.has(reviewer.reviewer)) {
      invalid(`${location}.reviewer`, "duplicate reviewer");
    }
    seen.add(reviewer.reviewer);
  }
  const trusted = array(result.instructions, `${path}.instructions`);
  for (const [index, item] of trusted.entries()) {
    instructions(item, `${path}.instructions[${index}]`);
  }
  if (local && trusted.length === 0) {
    invalid(
      `${path}.instructions`,
      "local reviewers require trusted fixed instructions"
    );
  }
  producer(result.ladder, `${path}.ladder`);
};
