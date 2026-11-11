import { describe, expect, test } from "bun:test";

import { classifyNpmPublishResult, evaluateNpmEvidence } from "../src/index.ts";
import type { NpmRegistryRead } from "../src/index.ts";
import {
  fixtureDist,
  found,
  metadata,
  npmPolicy,
  publication,
} from "./npm-fixtures.ts";

const evaluate = (document: unknown) =>
  evaluateNpmEvidence(
    publication(),
    { document, status: "found" },
    npmPolicy()
  );

describe("npm immutable evidence", () => {
  test("matching identity, staged SHA-512, provenance reference and tag completes", () => {
    expect(evaluate(metadata())).toEqual({ reasons: [], state: "complete" });
  });

  test("absent package and absent exact version remain incomplete", () => {
    expect(
      evaluateNpmEvidence(publication(), { status: "not-found" }, npmPolicy())
    ).toEqual({ reasons: ["missing-version"], state: "incomplete" });
    expect(evaluate({ name: publication().name, versions: {} }).state).toBe(
      "incomplete"
    );
  });

  test("version existence and correct tag do not excuse absent integrity/provenance", () => {
    const doc = metadata();
    Reflect.deleteProperty(fixtureDist(doc), "integrity");
    Reflect.deleteProperty(fixtureDist(doc), "attestations");
    expect(evaluate(doc)).toEqual({
      reasons: ["missing-integrity", "missing-provenance-reference"],
      state: "incomplete",
    });
  });

  test("occupied immutable version with different artifact is a conflict", () => {
    const doc = metadata();
    fixtureDist(doc).integrity =
      `sha512-${Buffer.alloc(64, 2).toString("base64")}`;
    expect(evaluate(doc)).toEqual({
      reasons: ["integrity-conflict"],
      state: "conflict",
    });
  });

  test("wrong tag or predicate remains unsatisfied", () => {
    const doc = metadata();
    doc["dist-tags"].latest = "1.2.2";
    fixtureDist(doc).attestations.provenance.predicateType = "other";
    expect(evaluate(doc)).toEqual({
      reasons: ["provenance-predicate-mismatch", "dist-tag-mismatch"],
      state: "incomplete",
    });
  });

  test.each([
    { ...metadata(), name: "@other/core" },
    {
      ...metadata(),
      versions: {
        "1.2.3": { ...metadata().versions["1.2.3"], name: "@other/core" },
      },
    },
    {
      ...metadata(),
      versions: {
        "1.2.3": { ...metadata().versions["1.2.3"], version: "2.0.0" },
      },
    },
  ])("rejects wrong top-level or version subject %#", (doc) => {
    expect(evaluate(doc)).toEqual({
      reasons: ["identity-mismatch"],
      state: "invalid",
    });
  });

  test.each(
    [
      null,
      [],
      {},
      { name: publication().name, versions: null },
      { ...metadata(), "dist-tags": [] },
      { ...metadata(), versions: { "1.2.3": null } },
      {
        ...metadata(),
        versions: {
          "1.2.3": { dist: [], name: publication().name, version: "1.2.3" },
        },
      },
      {
        ...metadata(),
        versions: {
          "1.2.3": { ...metadata().versions["1.2.3"], dist: { integrity: 7 } },
        },
      },
      {
        ...metadata(),
        versions: {
          "1.2.3": {
            ...metadata().versions["1.2.3"],
            dist: { attestations: [] },
          },
        },
      },
      {
        ...metadata(),
        versions: {
          "1.2.3": {
            ...metadata().versions["1.2.3"],
            dist: { attestations: { provenance: false } },
          },
        },
      },
      {
        ...metadata(),
        versions: {
          "1.2.3": {
            ...metadata().versions["1.2.3"],
            dist: { attestations: { provenance: { predicateType: 7 } } },
          },
        },
      },
    ].map((document) => ({ document }))
  )("malformed relevant metadata cannot pass %#", ({ document }) => {
    expect(evaluate(document).state).toBe("invalid");
  });

  test("prototype/inherited evidence is not registry JSON", () => {
    expect(evaluate(Object.create(metadata())).state).toBe("invalid");
    const doc = metadata();
    doc.versions = Object.create(doc.versions);
    expect(evaluate(doc).state).toBe("invalid");
  });

  test.each([
    "authentication",
    "rate-limit",
    "network",
    "registry-error",
  ] as const)("preserves unavailable %s", (reason) => {
    expect(
      evaluateNpmEvidence(
        publication(),
        { reason, status: "unavailable" },
        npmPolicy()
      )
    ).toEqual({ reasons: [reason], state: "unavailable" });
  });

  test("malformed transport result and invalid expectation fail closed", () => {
    expect(
      evaluateNpmEvidence(
        publication(),
        { status: "ok" } as unknown as NpmRegistryRead,
        npmPolicy()
      ).state
    ).toBe("invalid");
    expect(
      evaluateNpmEvidence(
        { ...publication(), integrity: "sha512-not-a-digest" },
        found(),
        npmPolicy()
      ).state
    ).toBe("invalid");
    expect(
      evaluateNpmEvidence(publication(), found(), {
        provenancePredicateType: "",
      }).state
    ).toBe("invalid");
  });
});

describe("publish subprocess result is separate from registry completion", () => {
  test("exit zero earns verification, never a completed artifact", () => {
    expect(
      classifyNpmPublishResult("1.2.3", { exitCode: 0, stderr: "" })
    ).toEqual({ outcome: "verify", publishSucceeded: true });
  });

  test.each(["", "."])(
    "exact immutable conflict %s earns verification without claiming publish succeeded",
    (suffix) => {
      expect(
        classifyNpmPublishResult("1.2.3", {
          exitCode: 1,
          stderr: `npm error You cannot publish over the previously published versions: 1.2.3${suffix}\r\n`,
        })
      ).toEqual({ outcome: "verify", publishSucceeded: false });
    }
  );

  test.each([
    "You cannot publish over the previously published versions: 1.2.30",
    "You cannot publish over the previously published versions: 2.0.0",
    "unrelated authentication failure",
    "network timeout",
  ])("unrelated publish error remains failed: %s", (stderr) => {
    expect(
      classifyNpmPublishResult("1.2.3", { exitCode: 1, stderr }).outcome
    ).toBe("failed");
  });
});
