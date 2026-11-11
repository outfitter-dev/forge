import { createHash } from "node:crypto";

import type {
  ReleasePolicy,
  ReleasePolicyEvidence,
  ReleaseSubject,
} from "./release-policy-types.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/\s/u.test(value) &&
  !value.includes(String.fromCodePoint(0));
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const branchRef = (value: unknown): value is string =>
  text(value) &&
  value.startsWith("refs/heads/") &&
  value.length > "refs/heads/".length;
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
const list = <T>(value: unknown, valid: (item: T) => boolean): value is T[] =>
  Array.isArray(value) && value.length <= 100 && [...value].every(valid);
const texts = (value: unknown): value is string[] =>
  list(value, text) && new Set(value).size === value.length;
const state = (value: unknown) =>
  [
    "passed",
    "failed",
    "missing",
    "incomplete",
    "canceled",
    "skipped",
    "unsupported",
  ].includes(value as string);
const repo = (value: unknown): value is string =>
  text(value) && /^[^/]+\/[^/]+$/u.test(value);
const sri = (value: unknown): value is string =>
  typeof value === "string" &&
  /^sha512-[A-Za-z0-9+/]{86}==$/u.test(value) &&
  Buffer.from(value.slice(7), "base64").toString("base64") === value.slice(7);

const subjectFields = [
  "repository",
  "ref",
  "sourceSha",
  "workflowSha",
  "validatorSha",
  "runtime",
  "artifactIntegrity",
  "version",
  "tag",
];
export const validReleaseSubject = (value: ReleaseSubject): boolean =>
  record(value) &&
  only(value, subjectFields) &&
  repo(value.repository) &&
  branchRef(value.ref) &&
  text(value.runtime) &&
  text(value.version) &&
  text(value.tag) &&
  sha(value.sourceSha) &&
  sha(value.workflowSha) &&
  sha(value.validatorSha) &&
  sri(value.artifactIntegrity);

const validChannel = (value: ReleasePolicy["channels"][number]) =>
  record(value) &&
  only(value, ["label", "tag", "autoAllowed"]) &&
  text(value.label) &&
  value.label.startsWith("channel:") &&
  value.label.length > 8 &&
  text(value.tag) &&
  typeof value.autoAllowed === "boolean";
const checkName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  value.trim().length > 0 &&
  !value.includes("\n") &&
  !value.includes("\r") &&
  !value.includes(String.fromCodePoint(0));
const ciIdentity = (value: ReleasePolicy["ciChecks"][number]) =>
  record(value) && checkName(value.name) && text(value.producer);
const validPolicyChecks = (policy: ReleasePolicy) =>
  texts(policy.requiredChecks) &&
  policy.requiredChecks.length > 0 &&
  texts(policy.autoChecks) &&
  !policy.autoChecks.some((id) => policy.requiredChecks.includes(id)) &&
  list(policy.ciChecks, ciIdentity) &&
  policy.ciChecks.length > 0 &&
  policy.ciChecks.every((check) => only(check, ["name", "producer"])) &&
  new Set(
    policy.ciChecks.map((check) => JSON.stringify([check.name, check.producer]))
  ).size === policy.ciChecks.length;

export const validReleasePolicy = (value: ReleasePolicy): boolean =>
  record(value) &&
  only(value, [
    "repository",
    "ref",
    "channels",
    "releaseLabels",
    "requiredChecks",
    "autoChecks",
    "ciChecks",
  ]) &&
  repo(value.repository) &&
  branchRef(value.ref) &&
  list(value.channels, validChannel) &&
  value.channels.length > 0 &&
  new Set(value.channels.map((channel) => channel.label)).size ===
    value.channels.length &&
  new Set(value.channels.map((channel) => channel.tag)).size ===
    value.channels.length &&
  texts(value.releaseLabels) &&
  value.releaseLabels.length > 0 &&
  value.releaseLabels.every(
    (label) => label.startsWith("release:") && label.length > 8
  ) &&
  validPolicyChecks(value);

/** Object key insertion order is irrelevant; array order remains part of the declared policy. */
export const releasePolicyDigest = (policy: ReleasePolicy): string | null => {
  if (!validReleasePolicy(policy)) {
    return null;
  }
  const serialized = JSON.stringify(policy, (_key, value: unknown) =>
    record(value)
      ? Object.fromEntries(
          Object.keys(value)
            .toSorted()
            .map((key) => [key, value[key]])
        )
      : value
  );
  return `sha256-${createHash("sha256").update(serialized).digest("hex")}`;
};

const uniqueCiRuns = (
  checks: NonNullable<ReleasePolicyEvidence["ci"]>["checks"]
) =>
  new Set(checks.map((check) => JSON.stringify([check.name, check.producer])))
    .size === checks.length &&
  new Set(checks.map((check) => JSON.stringify([check.producer, check.runId])))
    .size === checks.length;

const validCi = (ci: ReleasePolicyEvidence["ci"]): boolean =>
  ci === null ||
  (record(ci) &&
    only(ci, ["proof", "testedSha", "checks"]) &&
    ["exact-sha", "release-pr-head", "assumed"].includes(ci.proof) &&
    sha(ci.testedSha) &&
    list(
      ci.checks,
      (check: NonNullable<ReleasePolicyEvidence["ci"]>["checks"][number]) =>
        ciIdentity(check) &&
        only(check, ["name", "producer", "runId", "state"]) &&
        text(check.runId) &&
        state(check.state)
    ) &&
    uniqueCiRuns(ci.checks));

export const validReleaseEvidence = (value: ReleasePolicyEvidence): boolean =>
  record(value) &&
  only(value, [
    "subject",
    "policyDigest",
    "labels",
    "noPublishReason",
    "publication",
    "checks",
    "ci",
  ]) &&
  validReleaseSubject(value.subject) &&
  typeof value.policyDigest === "string" &&
  /^sha256-[a-f0-9]{64}$/u.test(value.policyDigest) &&
  texts(value.labels) &&
  (value.noPublishReason === null ||
    (typeof value.noPublishReason === "string" &&
      value.noPublishReason.trim().length > 0 &&
      value.noPublishReason.length <= 4096)) &&
  ["unpublished", "complete", "partial", "conflict", "unavailable"].includes(
    value.publication
  ) &&
  list(
    value.checks,
    (check: ReleasePolicyEvidence["checks"][number]) =>
      record(check) &&
      only(check, ["id", "state"]) &&
      text(check.id) &&
      state(check.state)
  ) &&
  new Set(value.checks.map((check) => check.id)).size === value.checks.length &&
  validCi(value.ci);
