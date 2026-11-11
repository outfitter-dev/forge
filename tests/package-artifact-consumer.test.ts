import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { qualifyFixturePackage } from "./package-artifact-consumer.ts";
import { artifactContract } from "./package-artifact-fixtures.ts";

const builtFiles = {
  "index.d.ts": "export declare const value: number;",
  "index.js": "export const value = 42;",
};

test("real packed built artifact installs/imports/typechecks offline in a clean consumer", async () => {
  const result = await qualifyFixturePackage(artifactContract(), builtFiles);
  expect(result.workspacePassed).toBe(true);
  expect(result.decision.state).toBe("complete");
  expect(
    result.evidence.checks.every((check) => check.status === "passed")
  ).toBe(true);
  expect(result.pack.files).toContain("package.json");
  expect(result.decision.binding?.artifactIntegrity).toBe(
    result.pack.integrity
  );
  expect(existsSync(result.root)).toBe(false);
}, 20_000);

test("product may choose source TypeScript under an explicit Bun contract", async () => {
  const contract = artifactContract();
  contract.allowedFiles = ["package.json", "index.ts"];
  contract.requiredFiles = [...contract.allowedFiles];
  contract.entrypoints = {
    exports: { ".": { import: "./index.ts", types: "./index.ts" } },
    types: "index.ts",
  };
  const result = await qualifyFixturePackage(contract, {
    "index.ts": "export const value: number = 42;",
  });
  expect(result.decision.state).toBe("complete");
  expect(existsSync(result.root)).toBe(false);
}, 20_000);

test("a passing source workspace cannot hide an unpublished runtime file", async () => {
  const result = await qualifyFixturePackage(artifactContract(), {
    ...builtFiles,
    "index.js": "export { value } from './src/hidden.js';",
    "src/hidden.js": "export const value=42;",
  });
  expect(result.workspacePassed).toBe(true);
  expect(result.pack.files).not.toContain("src/hidden.js");
  expect(result.decision.state).toBe("blocked");
  expect(result.decision.reasons).toContain("consumer-failed:import-root");
  expect(existsSync(result.root)).toBe(false);
}, 20_000);

test("runtime success does not excuse incompatible published types", async () => {
  const result = await qualifyFixturePackage(artifactContract(), {
    ...builtFiles,
    "index.d.ts": "export declare const value: string;",
  });
  expect(
    result.evidence.checks.find((check) => check.id === "import-root")?.status
  ).toBe("passed");
  expect(result.decision.reasons).toContain("consumer-failed:type-root");
  expect(existsSync(result.root)).toBe(false);
}, 20_000);

test("a declaration present in source but excluded from the pack is missing", async () => {
  const result = await qualifyFixturePackage(artifactContract(), builtFiles, {
    files: ["index.js"],
  });
  expect(result.pack.files).not.toContain("index.d.ts");
  expect(result.decision.reasons).toContain("missing-entrypoint:index.d.ts");
  expect(existsSync(result.root)).toBe(false);
}, 20_000);

test("a real extra packed file violates the product allowlist", async () => {
  const result = await qualifyFixturePackage(
    artifactContract(),
    { ...builtFiles, "debug.json": "{}" },
    { files: ["index.js", "index.d.ts", "debug.json"] }
  );
  expect(result.decision.reasons).toContain("forbidden-file:debug.json");
  expect(existsSync(result.root)).toBe(false);
}, 20_000);

test("packing and artifact install skip lifecycle scripts", async () => {
  const result = await qualifyFixturePackage(artifactContract(), builtFiles, {
    scripts: {
      install: "exit 7",
      postinstall: "exit 7",
      postpack: "exit 7",
      preinstall: "exit 7",
      prepack: "exit 7",
      prepare: "exit 7",
    },
  });
  expect(result.decision.state).toBe("complete");
  expect(existsSync(result.root)).toBe(false);
}, 20_000);
