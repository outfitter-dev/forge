import { generatedReleaseDiffPolicyDigest } from "../src/index.ts";
import type {
  GeneratedReleaseDiffEvidence,
  GeneratedReleaseDiffPolicy,
  GeneratedReleaseDiffSubject,
} from "../src/index.ts";

export const diffSubject: GeneratedReleaseDiffSubject = {
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  repository: "example/release-fixture",
  runtime: "bun@1.4.4",
  validatorSha: "d".repeat(40),
  workflowSha: "c".repeat(40),
};
export const diffPolicy: GeneratedReleaseDiffPolicy = {
  changesetPaths: [".changeset/brave-cats.md", ".changeset/other.md"],
  packages: [
    {
      changelogPath: "packages/ui/CHANGELOG.md",
      manifestPath: "packages/ui/package.json",
      name: "ui",
    },
    {
      changelogPath: "packages/tokens/CHANGELOG.md",
      manifestPath: "packages/tokens/package.json",
      name: "tokens",
    },
  ],
  repository: diffSubject.repository,
};
export const diffEvidence = (): GeneratedReleaseDiffEvidence => ({
  files: [
    { path: "packages/ui/package.json", status: "M" },
    { path: "packages/ui/CHANGELOG.md", status: "M" },
    { path: ".changeset/brave-cats.md", status: "D" },
  ],
  policyDigest: generatedReleaseDiffPolicyDigest(diffPolicy) ?? "invalid",
  state: "complete",
  subject: structuredClone(diffSubject),
});
