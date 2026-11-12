import type { ProducerPolicy } from "./evidence-types.ts";
import {
  choice,
  invalid,
  object,
  producer,
  repository,
  text,
} from "./evidence-validation-primitives.ts";
import type { CheckReceiptExpectation } from "./normalize-check-receipts.ts";

/**
 * The trusted policy `forge gate` judges one pull request under. The invoker
 * guarantees it comes from a trusted revision and never from the pull request
 * under evaluation; nothing here can check that.
 */
export interface GatePolicy {
  schemaVersion: 1;
  kind: "forge-gate-policy";
  /**
   * An `EvidencePolicyV2`, passed to the evaluator as it is. Only the fields
   * named here were checked; the evaluator validates the whole of it.
   */
  evidence: Record<string, unknown> & {
    schemaVersion: 2;
    repository: string;
    collector: ProducerPolicy;
    verification: ProducerPolicy;
  };
  /** For each verification gate, the declared check ID that satisfies it. */
  checks: CheckReceiptExpectation["checks"];
  /**
   * How a repository adopts the collector's rule for `mergeAuthorized`: the
   * head branch is in the base repository and the pull request does not carry
   * `holdLabel`. Naming a hold label anywhere else never adopts it.
   */
  mergeAuthorization: {
    rule: "same-repository-unless-held";
    holdLabel: string;
  };
}

const KIND = "forge-gate-policy";
const RULE = "same-repository-unless-held";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A producer and fingerprint in the evaluator's own form, with nothing beside them. */
const issuer = (value: unknown, path: string): ProducerPolicy => {
  const result = producer(value, path);
  return {
    producer: text(result.producer, `${path}.producer`),
    runtimeFingerprint: text(
      result.runtimeFingerprint,
      `${path}.runtimeFingerprint`
    ),
  };
};

const evidence = (value: unknown, path: string): GatePolicy["evidence"] => {
  if (!isRecord(value)) {
    return invalid(path, "expected a JSON object");
  }
  choice(value.schemaVersion, `${path}.schemaVersion`, [2]);
  repository(value.repository, `${path}.repository`);
  return {
    ...value,
    collector: issuer(value.collector, `${path}.collector`),
    repository: text(value.repository, `${path}.repository`),
    schemaVersion: 2,
    verification: issuer(value.verification, `${path}.verification`),
  };
};

/** The collector's rule for a hold label: printable ASCII with no space at either end. */
const holdLabel = (value: unknown, path: string): string => {
  const label = text(value, path);
  return /^[ -~]+$/u.test(label)
    ? label
    : invalid(path, "expected printable ASCII");
};

/**
 * Checks decoded JSON against the gate policy format and returns it as a new
 * object. Every level takes exactly its own fields, except `evidence`, whose
 * remaining fields are the evaluator's to check. An issue names a field and
 * what was expected, and never holds the field's value.
 *
 * @throws {InvalidEvidenceError} With the path of the first field that is not as described.
 */
export const parseGatePolicy = (value: unknown): GatePolicy => {
  // Checked on a detached copy, so what is returned is what was checked.
  const root = object(structuredClone(value), "gatePolicy", [
    "schemaVersion",
    "kind",
    "evidence",
    "checks",
    "mergeAuthorization",
  ]);
  choice(root.schemaVersion, "gatePolicy.schemaVersion", [1]);
  choice(root.kind, "gatePolicy.kind", [KIND]);
  const checks = object(root.checks, "gatePolicy.checks", [
    "lint",
    "test",
    "build",
  ]);
  const authorization = object(
    root.mergeAuthorization,
    "gatePolicy.mergeAuthorization",
    ["rule", "holdLabel"]
  );
  // A policy that names no rule, or another one, has not adopted this one.
  choice(authorization.rule, "gatePolicy.mergeAuthorization.rule", [RULE]);
  return {
    checks: {
      build: text(checks.build, "gatePolicy.checks.build"),
      lint: text(checks.lint, "gatePolicy.checks.lint"),
      test: text(checks.test, "gatePolicy.checks.test"),
    },
    evidence: evidence(root.evidence, "gatePolicy.evidence"),
    kind: KIND,
    mergeAuthorization: {
      holdLabel: holdLabel(
        authorization.holdLabel,
        "gatePolicy.mergeAuthorization.holdLabel"
      ),
      rule: RULE,
    },
    schemaVersion: 1,
  };
};
