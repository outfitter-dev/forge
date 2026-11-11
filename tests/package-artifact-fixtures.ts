import { packageArtifactContractDigest } from "../src/index.ts";
import type {
  PackageArtifactContract,
  PackageArtifactSubject,
  PackageConsumerEvidence,
  PackedPackageEvidence,
} from "../src/index.ts";

export const artifactContract = (): PackageArtifactContract => ({
  allowedFiles: ["package.json", "index.js", "index.d.ts", "README.md"],
  checks: [
    { id: "install", kind: "install" },
    { id: "import-root", kind: "runtime" },
    { id: "type-root", kind: "types" },
  ],
  entrypoints: {
    exports: {
      ".": Object.fromEntries([
        ["types", "./index.d.ts"],
        ["import", "./index.js"],
      ]),
    },
    types: "index.d.ts",
  },
  name: "@forge-fixture/example",
  requiredFiles: ["package.json", "index.js", "index.d.ts"],
  runtime: `bun@${Bun.version}/${process.platform}/${process.arch}`,
  version: "1.2.3",
});

export const artifactSubject = (): PackageArtifactSubject => ({
  artifactIntegrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
  repository: "example/product",
  sourceRevision: "a".repeat(40),
  validatorRevision: "b".repeat(40),
});

export const artifactFixture = () => {
  const contract = artifactContract();
  const subject = artifactSubject();
  const pack: PackedPackageEvidence = {
    files: [...contract.requiredFiles],
    integrity: subject.artifactIntegrity,
    manifest: {
      name: contract.name,
      type: "module",
      version: contract.version,
      ...contract.entrypoints,
    },
  };
  const digest = packageArtifactContractDigest(contract);
  if (!digest) {
    throw new Error("invalid fixture contract");
  }
  const consumer: PackageConsumerEvidence = {
    ...subject,
    checks: contract.checks.map(({ id }) => ({ id, status: "passed" })),
    cleanup: "complete",
    contractDigest: digest,
    isolation: "disposable-artifact-only",
    runtime: contract.runtime,
  };
  return { consumer, contract, pack, subject };
};
