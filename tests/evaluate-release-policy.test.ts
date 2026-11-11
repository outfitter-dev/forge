import { describe, expect, test } from "bun:test";

import { evaluateReleasePolicy } from "../src/index.ts";
import type { ReleaseCheckState } from "../src/index.ts";
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
const nonPassing: ReleaseCheckState[] = [
  "failed",
  "missing",
  "incomplete",
  "canceled",
  "skipped",
  "unsupported",
];

describe("release intent routing adapted from the existing classifier", () => {
  test("verified explicit product policy selects auto without an execution grant", () => {
    const fixture = releaseFixture();
    expect(evaluate(fixture)).toMatchObject({
      blockers: [],
      decision: "auto",
      diagnostics: [],
      reasons: ["automatic-eligibility-met"],
    });
    expect(evaluate(fixture).binding).toEqual({
      ...fixture.subject,
      policyDigest: fixture.evidence.policyDigest,
    });
    expect(evaluate(fixture)).not.toHaveProperty("shouldPublish");
    expect(evaluate(fixture)).not.toHaveProperty("createGitHubRelease");
  });

  test.each([{ intent: [] }, { intent: ["publish:manual"] }])(
    "absent/explicit manual intent selects manual after safety checks %#",
    ({ intent }) => {
      const fixture = releaseFixture();
      fixture.evidence.labels = [...intent, "channel:stable"];
      expect(evaluate(fixture).decision).toBe("manual");
    }
  );

  test.each(["publish:", "channel:", "release:"])(
    "unknown %s intent blocks",
    (prefix) => {
      const fixture = releaseFixture();
      fixture.evidence.labels.push(`${prefix}unknown`);
      expect(evaluate(fixture).blockers).toContain(`unknown-intent:${prefix}`);
    }
  );

  test.each(["publish:manual", "channel:preview", "release:major"])(
    "conflicting %s blocks before routing",
    (label) => {
      const fixture = releaseFixture();
      fixture.evidence.labels.push(label);
      expect(evaluate(fixture).decision).toBe("block");
    }
  );

  test("publish:block overrides otherwise passing evidence", () => {
    const fixture = releaseFixture();
    fixture.evidence.labels = ["publish:block"];
    expect(evaluate(fixture).blockers).toContain("publish-block");
  });

  test("none needs an audit reason and never requires publication execution", () => {
    const fixture = releaseFixture();
    fixture.evidence.labels = ["publish:none"];
    expect(evaluate(fixture).blockers).toContain("missing-skip-reason");
    fixture.evidence.noPublishReason = "Owner deliberately holds this version.";
    fixture.evidence.checks = [];
    fixture.evidence.ci = null;
    expect(evaluate(fixture)).toMatchObject({
      decision: "none",
      reasons: ["audited-publish-none"],
    });
    expect(JSON.stringify(evaluate(fixture))).not.toContain(
      fixture.evidence.noPublishReason
    );
  });

  test.each(["partial", "conflict", "unavailable"] as const)(
    "%s publication cannot be hidden by none/manual/auto",
    (publication) => {
      for (const intent of ["publish:none", "publish:manual", "publish:auto"]) {
        const fixture = releaseFixture();
        fixture.evidence.labels = [intent, "channel:stable"];
        fixture.evidence.noPublishReason = "Hold";
        fixture.evidence.publication = publication;
        expect(evaluate(fixture).blockers).toContain(
          `publication-${publication}`
        );
      }
    }
  );

  test("complete publication is evidence, not a command to republish", () => {
    const fixture = releaseFixture();
    fixture.evidence.publication = "complete";
    expect(evaluate(fixture).decision).toBe("auto");
    expect(evaluate(fixture)).not.toHaveProperty("shouldPublish");
  });

  test.each(nonPassing)(
    "required safety check %s blocks manual as well as auto",
    (state) => {
      for (const intent of ["publish:auto", "publish:manual"]) {
        const fixture = releaseFixture();
        fixture.evidence.labels = [intent, "channel:stable"];
        fixture.evidence.checks = fixture.evidence.checks.map((check) =>
          check.id === "artifact" ? { ...check, state } : check
        );
        expect(evaluate(fixture).blockers).toContain(
          `required-check:artifact:${state}`
        );
      }
    }
  );

  test("omitted safety evidence blocks", () => {
    const fixture = releaseFixture();
    fixture.evidence.checks = fixture.evidence.checks.filter(
      (check) => check.id !== "artifact"
    );
    expect(evaluate(fixture).blockers).toContain(
      "required-check:artifact:missing"
    );
  });

  test.each(nonPassing)(
    "auto-only check %s routes to manual under explicit product policy",
    (state) => {
      const fixture = releaseFixture();
      fixture.evidence.checks = fixture.evidence.checks.map((check) =>
        check.id === "stack-boundary" ? { ...check, state } : check
      );
      expect(evaluate(fixture)).toMatchObject({
        blockers: [],
        decision: "manual",
        diagnostics: [`auto-check:stack-boundary:${state}`],
      });
    }
  );

  test("omitted auto-only evidence cannot qualify auto", () => {
    const fixture = releaseFixture();
    fixture.evidence.checks = fixture.evidence.checks.filter(
      (check) => check.id !== "generated-diff"
    );
    expect(evaluate(fixture).diagnostics).toContain(
      "auto-check:generated-diff:missing"
    );
    expect(evaluate(fixture).decision).toBe("manual");
  });

  test("product channel policy is explicit; preview need not be auto eligible", () => {
    const fixture = releaseFixture();
    fixture.subject.tag = "preview";
    fixture.evidence.subject.tag = "preview";
    fixture.evidence.labels = ["publish:auto", "channel:preview"];
    expect(evaluate(fixture).decision).toBe("manual");
    const preview = fixture.policy.channels.find(
      (channel) => channel.tag === "preview"
    );
    if (!preview) {
      throw new Error("fixture channel missing");
    }
    preview.autoAllowed = true;
    refreshReleasePolicy(fixture);
    expect(evaluate(fixture).decision).toBe("auto");
  });

  test("missing channel excludes auto and wrong channel/tag blocks", () => {
    const fixture = releaseFixture();
    fixture.evidence.labels = ["publish:auto"];
    expect(evaluate(fixture).decision).toBe("manual");
    fixture.evidence.labels.push("channel:preview");
    expect(evaluate(fixture).blockers).toContain("channel-tag-mismatch");
  });
});
