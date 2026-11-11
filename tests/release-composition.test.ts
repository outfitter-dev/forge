import { describe, expect, test } from "bun:test";

import {
  evaluateReleasePolicy,
  generatedReleaseDiffPolicyDigest,
} from "../src/index.ts";
import type { GeneratedReleaseDiffSubject } from "../src/index.ts";
import { found, metadata } from "./npm-fixtures.ts";
import {
  composeFixture,
  compositionFixture,
} from "./release-composition-fixtures.ts";
import { refreshReleasePolicy } from "./release-policy-fixtures.ts";

const forIntent = (intent: "auto" | "manual") => {
  const fixture = compositionFixture();
  fixture.release.evidence.labels[0] = `publish:${intent}`;
  return fixture;
};

describe.each(["auto", "manual"] as const)(
  "offline release composition / %s",
  (intent) => {
    test("healthy synthetic facts satisfy every required product assessment", () => {
      const result = composeFixture(forIntent(intent));
      expect(result.results.diff.decision).toBe("pass");
      expect(result.results.version).toMatchObject({
        change: "patch",
        decision: "pass",
      });
      expect(result.results.artifact.state).toBe("complete");
      expect(result.results.npm.state).toBe("complete");
      expect(result.evidence.publication).toBe("complete");
      expect(result.decision).toMatchObject({ blockers: [], decision: intent });
    });
    test("unexpected generated edits block even explicit manual intent", () => {
      const fixture = forIntent(intent);
      fixture.diff.evidence.files.push({
        path: "src/unrelated.ts",
        status: "M",
      });
      const result = composeFixture(fixture);
      expect(result.results.diff.diagnostics).toContain(
        "Unexpected release diff entry: M src/unrelated.ts"
      );
      expect(result.decision.blockers).toContain(
        "required-check:generated-diff:failed"
      );
      expect(result.decision.decision).toBe("block");
    });
    test("malformed literal version cannot become a passing named assessment", () => {
      const fixture = forIntent(intent);
      fixture.version.input.version = "1.2.3-.next";
      const result = composeFixture(fixture);
      expect(result.results.version.decision).toBe("block");
      expect(result.decision.blockers).toContain(
        "required-check:version:failed"
      );
      expect(result.decision.decision).toBe("block");
    });
    test("a failed packed-artifact consumer check remains a mandatory blocker", () => {
      const fixture = forIntent(intent);
      fixture.artifact.consumer.checks = fixture.artifact.consumer.checks.map(
        (check) => ({ ...check, status: "canceled" })
      );
      const result = composeFixture(fixture);
      expect(result.results.artifact.state).toBe("blocked");
      expect(result.decision.blockers).toContain(
        "required-check:artifact:failed"
      );
      expect(result.decision.decision).toBe("block");
    });
    test("incomplete diff collection cannot be rescued by a manual label", () => {
      const fixture = forIntent(intent);
      fixture.diff.evidence.state = "incomplete";
      const result = composeFixture(fixture);
      expect(result.results.diff.diagnostics).toEqual(["diff-incomplete"]);
      expect(result.decision.decision).toBe("block");
    });
    test("missing registry metadata is incomplete, never permission to publish", () => {
      const fixture = forIntent(intent);
      fixture.npm.observation = { status: "not-found" };
      const result = composeFixture(fixture);
      expect(result.results.npm).toEqual({
        reasons: ["missing-version"],
        state: "incomplete",
      });
      expect(result.evidence.publication).toBe("partial");
      expect(result.decision.decision).toBe("block");
    });
    test.each(["incomplete", "conflict", "invalid", "unavailable"] as const)(
      "preserves npm %s and blocks progression",
      (state) => {
        const fixture = forIntent(intent);
        const doc = metadata(fixture.npm.expected);
        if (state === "incomplete") {
          doc["dist-tags"].latest = "1.2.2";
          fixture.npm.observation = { document: doc, status: "found" };
        } else if (state === "conflict") {
          const version = doc.versions[fixture.npm.expected.version];
          if (!version) {
            throw new Error("missing fixture version");
          }
          version.dist.integrity = `sha512-${Buffer.alloc(64, 2).toString("base64")}`;
          fixture.npm.observation = { document: doc, status: "found" };
        } else if (state === "invalid") {
          fixture.npm.observation = { document: null, status: "found" };
        } else {
          fixture.npm.observation = {
            reason: "authentication",
            status: "unavailable",
          };
        }
        const result = composeFixture(fixture);
        expect(result.results.npm.state).toBe(state);
        expect(result.evidence.publication).toBe(
          (
            {
              conflict: "conflict",
              incomplete: "partial",
              invalid: "unavailable",
              unavailable: "unavailable",
            } as const
          )[state]
        );
        expect(result.decision.decision).toBe("block");
      }
    );
    test("a green artifact for another repository is not relabeled as this product", () => {
      const fixture = forIntent(intent);
      fixture.artifact.subject.repository = "other/product";
      fixture.artifact.consumer.repository = "other/product";
      const result = composeFixture(fixture);
      expect(result.results.artifact.state).toBe("complete");
      expect(result.decision.blockers).toContain(
        "required-check:subject-association:failed"
      );
      expect(result.decision.decision).toBe("block");
    });
    test.each([
      ["name", "@other/package"],
      ["version", "9.9.9"],
      ["tag", "preview"],
      ["integrity", `sha512-${Buffer.alloc(64, 2).toString("base64")}`],
    ] as const)(
      "green registry metadata for another %s cannot satisfy association",
      (key, value) => {
        const fixture = forIntent(intent);
        fixture.npm.expected[key] = value;
        fixture.npm.observation = found(fixture.npm.expected);
        const result = composeFixture(fixture);
        expect(result.results.npm.state).toBe("complete");
        expect(result.decision.blockers).toContain(
          "required-check:subject-association:failed"
        );
        expect(result.decision.decision).toBe("block");
      }
    );
    test("matching predicate references do not establish authenticated provenance", () => {
      const fixture = forIntent(intent);
      fixture.release.policy.requiredChecks.push("authenticated-provenance");
      refreshReleasePolicy(fixture.release);
      const result = composeFixture(fixture);
      expect(result.results.npm).toEqual({ reasons: [], state: "complete" });
      result.evidence.checks.push({
        id: "authenticated-provenance",
        state: "unsupported",
      });
      const decision = evaluateReleasePolicy(
        fixture.release.subject,
        fixture.release.policy,
        result.evidence
      );
      expect(decision.blockers).toContain(
        "required-check:authenticated-provenance:unsupported"
      );
      expect(decision.decision).toBe("block");
    });
    test("old CI proof and a fresh manual label cannot qualify a different source", () => {
      const fixture = forIntent(intent);
      if (!fixture.release.evidence.ci) {
        throw new Error("fixture needs CI");
      }
      fixture.release.evidence.ci.testedSha = "f".repeat(40);
      expect(composeFixture(fixture).decision.blockers).toContain(
        "stale-ci-proof"
      );
    });
  }
);

test.each([
  "baseSha",
  "headSha",
  "repository",
  "runtime",
  "validatorSha",
  "workflowSha",
] as const)("passing diff %s must still match the release selection", (key) => {
  const fixture = compositionFixture();
  const other: Record<keyof GeneratedReleaseDiffSubject, string> = {
    baseSha: "e".repeat(40),
    headSha: "f".repeat(40),
    repository: "other/product",
    runtime: "bun@different",
    validatorSha: "e".repeat(40),
    workflowSha: "f".repeat(40),
  };
  fixture.diff.subject[key] = other[key];
  fixture.diff.evidence.subject[key] = other[key];
  if (key === "repository") {
    fixture.diff.policy.repository = other[key];
    fixture.diff.evidence.policyDigest =
      generatedReleaseDiffPolicyDigest(fixture.diff.policy) ?? "invalid";
  }
  const result = composeFixture(fixture);
  expect(result.results.diff.decision).toBe("pass");
  expect(result.decision.blockers).toContain(
    "required-check:subject-association:failed"
  );
  expect(result.decision.decision).toBe("block");
});

test("literal version success is not a revision-bound collection receipt", () => {
  const fixture = compositionFixture();
  fixture.collectedFor.sourceSha = "f".repeat(40);
  const result = composeFixture(fixture);
  expect(result.results.version.decision).toBe("pass");
  expect(result.decision.blockers).toContain(
    "required-check:subject-association:failed"
  );
});

test("an intent mismatch only excludes auto under this explicit product policy", () => {
  const fixture = compositionFixture();
  fixture.release.evidence.labels[2] = "release:minor";
  const result = composeFixture(fixture);
  expect(result.results.version.change).toBe("patch");
  expect(result.decision).toMatchObject({
    blockers: [],
    decision: "manual",
    diagnostics: ["auto-check:product-intent:failed"],
  });
  fixture.release.policy.requiredChecks.push("product-intent");
  fixture.release.policy.autoChecks = [];
  fixture.release.evidence.labels[0] = "publish:manual";
  refreshReleasePolicy(fixture.release);
  expect(composeFixture(fixture).decision.blockers).toContain(
    "required-check:product-intent:failed"
  );
});

test("outer evidence binding cannot refresh an old assessment envelope", () => {
  const fixture = compositionFixture();
  fixture.release.evidence.subject.sourceSha = "f".repeat(40);
  expect(composeFixture(fixture).decision.blockers).toEqual(["stale-evidence"]);
});
