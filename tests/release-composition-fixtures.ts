import {
  evaluateGeneratedReleaseDiff,
  evaluateNpmEvidence,
  evaluatePackageArtifact,
  evaluateReleasePolicy,
  evaluateReleaseVersion,
  generatedReleaseDiffPolicyDigest,
} from "../src/index.ts";
import type {
  GeneratedReleaseDiffEvidence,
  GeneratedReleaseDiffPolicy,
  GeneratedReleaseDiffSubject,
  NpmRegistryRead,
  ReleasePolicyEvidence,
  ReleaseVersionInput,
  ReleaseVersionPolicy,
} from "../src/index.ts";
import { found, npmPolicy, publication } from "./npm-fixtures.ts";
import { artifactFixture } from "./package-artifact-fixtures.ts";
import {
  refreshReleasePolicy,
  releaseFixture,
} from "./release-policy-fixtures.ts";

/** Synthetic attribution only: no collector, producer authentication or live publication is established here. */
export const compositionFixture = () => {
  const release = releaseFixture();
  const artifact = artifactFixture();
  release.subject.version = artifact.contract.version;
  release.subject.runtime = artifact.contract.runtime;
  artifact.subject.repository = release.subject.repository;
  artifact.consumer.repository = release.subject.repository;
  release.policy.requiredChecks = [
    "subject-association",
    "generated-diff",
    "version",
    "artifact",
    "npm-reference",
  ];
  release.policy.autoChecks = ["product-intent"];
  release.evidence.labels = ["publish:auto", "channel:stable", "release:patch"];
  release.evidence.subject = { ...release.subject };
  refreshReleasePolicy(release);
  const baseline = { sourceSha: "d".repeat(40), version: "1.2.2" };
  const diffSubject: GeneratedReleaseDiffSubject = {
    baseSha: baseline.sourceSha,
    headSha: release.subject.sourceSha,
    repository: release.subject.repository,
    runtime: release.subject.runtime,
    validatorSha: release.subject.validatorSha,
    workflowSha: release.subject.workflowSha,
  };
  const diffPolicy: GeneratedReleaseDiffPolicy = {
    changesetPaths: [".changeset/change.md"],
    packages: [
      {
        changelogPath: "CHANGELOG.md",
        manifestPath: "package.json",
        name: artifact.contract.name,
      },
    ],
    repository: release.subject.repository,
  };
  const expectedPublication = publication(artifact.contract.name);
  const versionInput: ReleaseVersionInput = {
    previousVersion: baseline.version,
    tag: release.subject.tag,
    version: release.subject.version,
  };
  const versionPolicy: ReleaseVersionPolicy = {
    prereleaseTags: [{ identifier: "beta", tag: "preview" }],
    stableTag: "latest",
  };
  return {
    artifact,
    baseline,
    // This captured fixture subject represents attribution a real trusted collector must independently establish.
    collectedFor: { ...release.subject },
    diff: {
      evidence: {
        files: [
          { path: "package.json", status: "M" },
          { path: "CHANGELOG.md", status: "M" },
          { path: ".changeset/change.md", status: "D" },
        ],
        policyDigest: generatedReleaseDiffPolicyDigest(diffPolicy) ?? "invalid",
        state: "complete" as GeneratedReleaseDiffEvidence["state"],
        subject: { ...diffSubject },
      },
      policy: diffPolicy,
      subject: diffSubject,
    },
    npm: {
      expected: expectedPublication,
      observation: found(expectedPublication) as NpmRegistryRead,
      policy: npmPolicy(),
    },
    packageName: artifact.contract.name,
    release,
    version: { input: versionInput, policy: versionPolicy },
  };
};

/** Fixture-local, explicit product mapping, not an exported Forge operation or production collector. */
export const composeFixture = (
  fixture: ReturnType<typeof compositionFixture>
) => {
  const {
    artifact,
    baseline,
    collectedFor,
    diff,
    npm,
    packageName,
    release,
    version,
  } = fixture;
  const { subject } = release;
  const results = {
    artifact: evaluatePackageArtifact(
      artifact.contract,
      artifact.subject,
      artifact.pack,
      artifact.consumer
    ),
    diff: evaluateGeneratedReleaseDiff(
      diff.subject,
      diff.policy,
      diff.evidence
    ),
    npm: evaluateNpmEvidence(npm.expected, npm.observation, npm.policy),
    version: evaluateReleaseVersion(version.input, version.policy),
  };
  // Compare independent expectations; do not relabel unrelated green results with the desired subject.
  const associated = [
    (Object.keys(subject) as (keyof typeof subject)[]).every(
      (key) => subject[key] === collectedFor[key]
    ),
    diff.subject.repository === subject.repository,
    diff.subject.headSha === subject.sourceSha,
    diff.subject.baseSha === baseline.sourceSha,
    diff.subject.workflowSha === subject.workflowSha,
    diff.subject.validatorSha === subject.validatorSha,
    diff.subject.runtime === subject.runtime,
    diff.policy.packages.length === 1,
    diff.policy.packages[0]?.name === packageName,
    artifact.subject.repository === subject.repository,
    artifact.subject.sourceRevision === subject.sourceSha,
    artifact.subject.validatorRevision === subject.validatorSha,
    artifact.subject.artifactIntegrity === subject.artifactIntegrity,
    artifact.contract.runtime === subject.runtime,
    artifact.contract.name === packageName,
    artifact.contract.version === subject.version,
    version.input.version === subject.version,
    version.input.tag === subject.tag,
    version.input.previousVersion === baseline.version,
    npm.expected.name === packageName,
    npm.expected.version === subject.version,
    npm.expected.tag === subject.tag,
    npm.expected.integrity === subject.artifactIntegrity,
  ].every(Boolean);
  // This fictional product deliberately maps finalization/prerelease advancement to patch intent; Forge does not.
  const intentLabels = {
    finalization: "release:patch",
    major: "release:major",
    minor: "release:minor",
    patch: "release:patch",
    prerelease: "release:patch",
  };
  const evidence: ReleasePolicyEvidence = {
    ...release.evidence,
    checks: [
      { id: "subject-association", state: associated ? "passed" : "failed" },
      {
        id: "generated-diff",
        state: results.diff.decision === "pass" ? "passed" : "failed",
      },
      {
        id: "version",
        state: results.version.decision === "pass" ? "passed" : "failed",
      },
      {
        id: "artifact",
        state: results.artifact.state === "complete" ? "passed" : "failed",
      },
      {
        id: "npm-reference",
        state: results.npm.state === "complete" ? "passed" : "failed",
      },
      {
        id: "product-intent",
        state:
          results.version.change !== null &&
          release.evidence.labels.includes(intentLabels[results.version.change])
            ? "passed"
            : "failed",
      },
    ],
    // Conservative reconciliation mapping. Partial means the desired metadata set is incomplete, not proof any publish occurred.
    publication: (
      {
        complete: "complete",
        conflict: "conflict",
        incomplete: "partial",
        invalid: "unavailable",
        unavailable: "unavailable",
      } as const
    )[results.npm.state],
  };
  return {
    decision: evaluateReleasePolicy(subject, release.policy, evidence),
    evidence,
    results,
  };
};
