import { expect, test } from "bun:test";

import { evaluateReleasePolicy } from "../src/index.ts";
import type { ReleaseCheckState, ReleaseSubject } from "../src/index.ts";
import {
  refreshReleasePolicy,
  releaseFixture,
} from "./release-policy-fixtures.ts";

const evaluate = ({
  subject,
  policy,
  evidence,
}: ReturnType<typeof releaseFixture>) =>
  evaluateReleasePolicy(subject, policy, evidence);

const ci = (fixture: ReturnType<typeof releaseFixture>) => {
  if (!fixture.evidence.ci) {
    throw new Error("fixture CI missing");
  }
  return fixture.evidence.ci;
};

test.each([
  "failed",
  "missing",
  "incomplete",
  "canceled",
  "skipped",
  "unsupported",
] satisfies ReleaseCheckState[])(
  "non-passing exact-head CI %s is a blocker even for manual",
  (state) => {
    const fixture = releaseFixture();
    fixture.evidence.labels = ["publish:manual"];
    ci(fixture).checks = ci(fixture).checks.map((check) => ({
      ...check,
      state,
    }));
    expect(evaluate(fixture).blockers).toContain(
      `required-ci:CI Gate:${state}`
    );
  }
);

test("missing proof or missing required run cannot pass", () => {
  const fixture = releaseFixture();
  ci(fixture).checks = [];
  expect(evaluate(fixture).blockers).toContain("required-ci:CI Gate:missing");
  fixture.evidence.ci = null;
  expect(evaluate(fixture).blockers).toContain("missing-ci-proof");
});

test.each(["release-pr-head", "assumed"] as const)(
  "%s proof is not silently reinterpreted as exact SHA",
  (proof) => {
    const fixture = releaseFixture();
    ci(fixture).proof = proof;
    expect(evaluate(fixture).blockers).toContain("unsupported-ci-proof");
  }
);

test("another tested commit or producer cannot supply required CI", () => {
  const fixture = releaseFixture();
  ci(fixture).testedSha = "d".repeat(40);
  expect(evaluate(fixture).blockers).toContain("stale-ci-proof");
  ci(fixture).testedSha = fixture.subject.sourceSha;
  ci(fixture).checks = ci(fixture).checks.map((check) => ({
    ...check,
    producer: "other",
  }));
  expect(evaluate(fixture).blockers).toContain("required-ci:CI Gate:missing");
});

test("duplicate CI results cannot be reduced to a convenient passing run", () => {
  const fixture = releaseFixture();
  ci(fixture).checks.push({
    name: "CI Gate",
    producer: "github-actions",
    runId: "other-run",
    state: "failed",
  });
  expect(evaluate(fixture).decision).toBe("block");
});

const altered: ReleaseSubject = {
  artifactIntegrity: `sha512-${Buffer.alloc(64, 2).toString("base64")}`,
  ref: "refs/heads/release",
  repository: "other/product",
  runtime: "different-runtime",
  sourceSha: "d".repeat(40),
  tag: "preview",
  validatorSha: "e".repeat(40),
  version: "9.0.0",
  workflowSha: "f".repeat(40),
};
test.each(Object.keys(altered) as (keyof ReleaseSubject)[])(
  "stale %s binding blocks",
  (key) => {
    const fixture = releaseFixture();
    fixture.evidence.subject[key] = altered[key];
    expect(evaluate(fixture).blockers).toContain("stale-evidence");
  }
);

test("changed consumer policy invalidates old results", () => {
  const fixture = releaseFixture();
  fixture.policy.autoChecks.push("changelog");
  expect(evaluate(fixture).blockers).toContain("stale-evidence");
});

test("wrong repository/ref/tag fails even when evidence is internally consistent", () => {
  const fixture = releaseFixture();
  fixture.subject.repository = "other/product";
  fixture.evidence.subject.repository = fixture.subject.repository;
  expect(evaluate(fixture).blockers).toContain("release-context-mismatch");
  fixture.subject.repository = fixture.policy.repository;
  fixture.evidence.subject.repository = fixture.policy.repository;
  fixture.subject.tag = "unknown";
  fixture.evidence.subject.tag = "unknown";
  expect(evaluate(fixture).blockers).toContain("unsupported-tag");
});

test("duplicate/unknown normalized checks do not qualify", () => {
  const fixture = releaseFixture();
  fixture.evidence.checks.push({ id: "artifact", state: "passed" });
  expect(evaluate(fixture).decision).toBe("block");
  fixture.evidence.checks.pop();
  fixture.evidence.checks.push({ id: "unconfigured", state: "passed" });
  expect(evaluate(fixture).decision).toBe("block");
});

test("ambiguous duplicate collection still blocks an audited skip", () => {
  const fixture = releaseFixture();
  fixture.evidence.labels = ["publish:none"];
  fixture.evidence.noPublishReason = "Hold release";
  fixture.evidence.checks.push({ id: "artifact", state: "passed" });
  expect(evaluate(fixture).decision).toBe("block");
});

test("unknown stronger policy cannot be ignored or echoed", () => {
  const fixture = releaseFixture();
  Object.assign(fixture.policy, { requireSigning: "must-not-leak" });
  const result = evaluate(fixture);
  expect(result).toMatchObject({ binding: null, decision: "block" });
  expect(JSON.stringify(result)).not.toContain("must-not-leak");
});

test("malformed status, sparse data and repeated labels fail closed", () => {
  const fixture = releaseFixture();
  Object.assign(fixture.evidence.checks[0] ?? {}, { state: "green" });
  expect(evaluate(fixture).blockers).toContain("invalid-evidence");
  fixture.evidence.checks = Array.from({ length: 1 });
  expect(evaluate(fixture).blockers).toContain("invalid-evidence");
  fixture.evidence.checks = [];
  fixture.evidence.labels.push("publish:auto");
  expect(evaluate(fixture).blockers).toContain("invalid-evidence");
});

test("required and auto-only policy classifications cannot overlap", () => {
  const fixture = releaseFixture();
  fixture.policy.autoChecks.push("artifact");
  expect(evaluate(fixture)).toMatchObject({ binding: null, decision: "block" });
});

test("arbitrary collection fields and claimed overrides are rejected without echo", () => {
  const fixture = releaseFixture();
  Object.assign(fixture.evidence, {
    modelOverride: "must-not-leak",
    stderr: "must-not-leak",
  });
  expect(evaluate(fixture).decision).toBe("block");
  expect(JSON.stringify(evaluate(fixture))).not.toContain("must-not-leak");
});

test("consumer can declare additional mandatory checks without changing the router", () => {
  const fixture = releaseFixture();
  fixture.policy.requiredChecks.push("signature");
  refreshReleasePolicy(fixture);
  expect(evaluate(fixture).blockers).toContain(
    "required-check:signature:missing"
  );
  fixture.evidence.checks.push({ id: "signature", state: "passed" });
  expect(evaluate(fixture).decision).toBe("auto");
});

test("an unexpected check cannot hide inside an audited skip", () => {
  const fixture = releaseFixture();
  fixture.evidence.labels = ["publish:none"];
  fixture.evidence.noPublishReason = "Hold";
  fixture.evidence.checks.push({ id: "unconfigured", state: "passed" });
  expect(evaluate(fixture).blockers).toContain("unexpected-check-evidence");
});

test("one check execution ID cannot supply two named CI runs", () => {
  const fixture = releaseFixture();
  fixture.policy.ciChecks.push({
    name: "another check",
    producer: "github-actions",
  });
  refreshReleasePolicy(fixture);
  ci(fixture).checks.push({
    name: "another check",
    producer: "github-actions",
    runId: "fixture-check-1",
    state: "passed",
  });
  expect(evaluate(fixture).blockers).toContain("invalid-evidence");
});

test("malformed digests, revisions and missing CI execution IDs fail closed", () => {
  const fixture = releaseFixture();
  ci(fixture).checks = ci(fixture).checks.map((check) => ({
    ...check,
    runId: "",
  }));
  expect(evaluate(fixture).blockers).toContain("invalid-evidence");
  fixture.subject.sourceSha = "main";
  expect(evaluate(fixture)).toMatchObject({ binding: null, decision: "block" });
});

test("unconfigured subjects and prototype-backed evidence cannot qualify", () => {
  const fixture = releaseFixture();
  fixture.evidence.subject = Object.create(fixture.subject) as ReleaseSubject;
  expect(evaluate(fixture).blockers).toContain("invalid-evidence");
});

test("an empty branch selector is invalid policy or subject, not a release context", () => {
  const fixture = releaseFixture();
  fixture.subject.ref = "refs/heads/";
  expect(evaluate(fixture)).toMatchObject({ binding: null, decision: "block" });
  fixture.subject.ref = "refs/heads/main";
  fixture.policy.ref = "refs/heads/";
  expect(evaluate(fixture)).toMatchObject({ binding: null, decision: "block" });
});
