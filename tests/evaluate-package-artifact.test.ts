import { describe, expect, test } from "bun:test";

import {
  evaluatePackageArtifact,
  packageArtifactContractDigest,
} from "../src/index.ts";
import type { PackageConsumerEvidence } from "../src/index.ts";
import { artifactFixture } from "./package-artifact-fixtures.ts";

const evaluate = ({
  contract,
  subject,
  pack,
  consumer,
}: ReturnType<typeof artifactFixture>) =>
  evaluatePackageArtifact(contract, subject, pack, consumer);

describe("packed package qualification", () => {
  test("requires exact pack and all declared clean-consumer checks", () => {
    const fixture = artifactFixture();
    expect(evaluate(fixture)).toEqual({
      binding: {
        ...fixture.subject,
        contractDigest: fixture.consumer.contractDigest,
        runtime: fixture.contract.runtime,
      },
      reasons: [],
      state: "complete",
    });
    expect(
      evaluatePackageArtifact(
        fixture.contract,
        fixture.subject,
        fixture.pack,
        null
      )
    ).toMatchObject({
      reasons: ["missing-consumer-evidence"],
      state: "blocked",
    });
  });

  test("required files and targets must be in the pack, even when workspace builds pass", () => {
    const fixture = artifactFixture();
    fixture.pack.files = ["package.json"];
    expect(evaluate(fixture)).toMatchObject({ state: "blocked" });
    expect(evaluate(fixture).reasons).toContain("missing-file:index.d.ts");
    expect(evaluate(fixture).reasons).toContain("missing-entrypoint:index.js");
  });

  test("unexpected packed files are forbidden; optional allowed files may be absent", () => {
    const fixture = artifactFixture();
    fixture.pack.files.push(".env");
    expect(evaluate(fixture)).toMatchObject({
      reasons: ["forbidden-file:.env"],
      state: "blocked",
    });
  });

  test.each([
    "../outside.js",
    "/tmp/code.js",
    "node_modules/dep/index.js",
    "lib/../code.js",
    "lib\\code.js",
    "lib/%2e%2e/code.js",
    "",
    "lib//code.js",
  ])("rejects unsafe packed path %s", (file) => {
    const fixture = artifactFixture();
    fixture.pack.files.push(file);
    expect(evaluate(fixture).state).toBe("invalid");
  });

  test("duplicate/sparse file lists and non-JSON manifests are invalid", () => {
    const fixture = artifactFixture();
    fixture.pack.files.push("package.json");
    expect(evaluate(fixture).state).toBe("invalid");
    fixture.pack.files = Array.from({ length: 1 });
    expect(evaluate(fixture).state).toBe("invalid");
    fixture.pack.files = fixture.contract.requiredFiles;
    fixture.pack.manifest = Object.create(fixture.pack.manifest as object);
    expect(evaluate(fixture).state).toBe("invalid");
  });

  test.each([{ name: "@other/pkg" }, { version: "9.0.0" }])(
    "rejects inconsistent manifest identity %#",
    (change) => {
      const fixture = artifactFixture();
      fixture.pack.manifest = {
        ...(fixture.pack.manifest as object),
        ...change,
      };
      expect(evaluate(fixture).reasons).toContain("package-identity-mismatch");
    }
  );

  test.each([
    { exports: "../outside.js" },
    { exports: { "./*": "./index.js" } },
    { exports: ["./index.js"] },
    { dependencies: { hidden: "workspace:*" } },
    { peerDependencies: { missing: "*" } },
    { optionalDependencies: { missing: "*" } },
    { imports: { "#source": "../source.js" } },
    { bin: "index.js" },
  ])("unsupported/escaping manifest cannot pass %#", (change) => {
    const fixture = artifactFixture();
    fixture.pack.manifest = { ...(fixture.pack.manifest as object), ...change };
    expect(evaluate(fixture).state).toBe("unsupported");
  });

  test("entrypoint fields and conditional priority must match contract", () => {
    const fixture = artifactFixture();
    fixture.pack.manifest = {
      ...(fixture.pack.manifest as object),
      exports: { ".": { import: "./index.js", types: "./index.d.ts" } },
      main: "index.js",
    };
    expect(evaluate(fixture).reasons).toEqual([
      "entrypoint-mismatch:exports",
      "entrypoint-mismatch:main",
    ]);
  });

  test.each([
    "artifactIntegrity",
    "repository",
    "sourceRevision",
    "validatorRevision",
    "runtime",
    "contractDigest",
  ] as const)("consumer %s must match exact binding", (key) => {
    const fixture = artifactFixture();
    const changes = {
      artifactIntegrity: `sha512-${Buffer.alloc(64, 2).toString("base64")}`,
      contractDigest: "sha256-different",
      repository: "other/product",
      runtime: "different-runtime",
      sourceRevision: "c".repeat(40),
      validatorRevision: "d".repeat(40),
    };
    fixture.consumer[key] = changes[key];
    expect(evaluate(fixture)).toMatchObject({
      reasons: ["stale-consumer-evidence"],
      state: "blocked",
    });
  });

  test("pack digest must match expected tarball, independently of consumer claims", () => {
    const fixture = artifactFixture();
    fixture.pack.integrity = `sha512-${Buffer.alloc(64, 2).toString("base64")}`;
    expect(evaluate(fixture).reasons).toEqual(["artifact-integrity-mismatch"]);
  });

  test.each(["failed", "canceled", "incomplete", "unsupported"] as const)(
    "consumer check %s blocks completion",
    (status) => {
      const fixture = artifactFixture();
      fixture.consumer.checks = [
        { id: "install", status },
        ...fixture.consumer.checks.slice(1),
      ];
      expect(evaluate(fixture).reasons).toEqual([`consumer-${status}:install`]);
    }
  );

  test("missing, extra and duplicate consumer results never pass", () => {
    const fixture = artifactFixture();
    fixture.consumer.checks.pop();
    expect(evaluate(fixture).reasons).toEqual(["consumer-check-set-mismatch"]);
    fixture.consumer.checks.push({ id: "undeclared", status: "passed" });
    expect(evaluate(fixture).reasons).toEqual(["consumer-check-set-mismatch"]);
    fixture.consumer.checks = [
      { id: "install", status: "passed" },
      { id: "install", status: "passed" },
    ];
    expect(evaluate(fixture).state).toBe("invalid");
  });

  test("workspace/link consumer and incomplete cleanup cannot pass", () => {
    const fixture = artifactFixture();
    fixture.consumer.isolation =
      "workspace-linked" as PackageConsumerEvidence["isolation"];
    expect(evaluate(fixture).reasons).toEqual(["unclean-consumer"]);
    fixture.consumer.isolation = "disposable-artifact-only";
    fixture.consumer.cleanup = "failed";
    expect(evaluate(fixture).reasons).toEqual(["consumer-cleanup-incomplete"]);
  });

  test("contract changes invalidate earlier probe evidence", () => {
    const fixture = artifactFixture();
    fixture.contract.allowedFiles.push("LICENSE");
    expect(evaluate(fixture).reasons).toEqual(["stale-consumer-evidence"]);
    expect(packageArtifactContractDigest(fixture.contract)).not.toBe(
      fixture.consumer.contractDigest
    );
  });

  test("invalid/unsupported contract never emits a usable binding", () => {
    const fixture = artifactFixture();
    fixture.contract.checks = fixture.contract.checks.filter(
      (check) => check.kind !== "types"
    );
    expect(evaluate(fixture)).toEqual({
      binding: null,
      reasons: ["invalid-input"],
      state: "invalid",
    });
    expect(packageArtifactContractDigest(fixture.contract)).toBeNull();
  });

  test.each([
    { exports: { ".": "./index.js", import: "./index.js" } },
    { exports: { ".": { "./nested": "./index.js" } } },
    { exports: { 0: "./index.js" } },
  ])("invalid exports map structure is unsupported %#", (change) => {
    const fixture = artifactFixture();
    fixture.pack.manifest = { ...(fixture.pack.manifest as object), ...change };
    expect(evaluate(fixture).state).toBe("unsupported");
  });

  test("malformed entrypoints cannot throw or pass", () => {
    const fixture = artifactFixture();
    fixture.pack.manifest = { ...(fixture.pack.manifest as object), main: 1n };
    expect(evaluate(fixture)).toMatchObject({
      reasons: ["malformed-entrypoint"],
      state: "invalid",
    });
  });

  test("malformed revisions fail closed before producing a binding", () => {
    const fixture = artifactFixture();
    fixture.subject.sourceRevision = "main";
    expect(evaluate(fixture)).toMatchObject({
      binding: null,
      state: "invalid",
    });
  });

  test("unsupported policy and malformed declared checks cannot be ignored", () => {
    const fixture = artifactFixture();
    Object.assign(fixture.contract, { requireSigning: true });
    expect(evaluate(fixture).state).toBe("invalid");
    Reflect.deleteProperty(fixture.contract, "requireSigning");
    fixture.contract.checks = Array.from({ length: 3 });
    expect(evaluate(fixture).state).toBe("invalid");
  });

  test("an excessively large exports tree cannot qualify", () => {
    const fixture = artifactFixture();
    const conditions = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `condition${index}`,
        "./index.js",
      ])
    );
    fixture.contract.entrypoints.exports = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`./path${index}`, conditions])
    );
    expect(packageArtifactContractDigest(fixture.contract)).toBeNull();
  });

  test("receipts omit unknown metadata and error/secret fields", () => {
    const fixture = artifactFixture();
    Object.assign(fixture.subject, { token: "must-not-appear" });
    Object.assign(fixture.pack, { stderr: "must-not-appear" });
    Object.assign(fixture.consumer, { stdout: "must-not-appear" });
    expect(JSON.stringify(evaluate(fixture))).not.toContain("must-not-appear");
  });
});
