import { releasePolicyDigest } from "../src/index.ts";
import type {
  ReleasePolicy,
  ReleasePolicyEvidence,
  ReleaseSubject,
} from "../src/index.ts";

export const releaseFixture = () => {
  const subject: ReleaseSubject = {
    artifactIntegrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
    ref: "refs/heads/main",
    repository: "example/release-fixture",
    runtime: "bun@1.4.4",
    sourceSha: "a".repeat(40),
    tag: "latest",
    validatorSha: "b".repeat(40),
    version: "1.1.0",
    workflowSha: "c".repeat(40),
  };
  const policy: ReleasePolicy = {
    autoChecks: ["generated-diff", "version-delta", "stack-boundary"],
    channels: [
      { autoAllowed: true, label: "channel:stable", tag: "latest" },
      { autoAllowed: false, label: "channel:preview", tag: "preview" },
    ],
    ciChecks: [{ name: "CI Gate", producer: "github-actions" }],
    ref: subject.ref,
    releaseLabels: ["release:major", "release:minor", "release:patch"],
    repository: subject.repository,
    requiredChecks: ["artifact", "release-context"],
  };
  const digest = releasePolicyDigest(policy);
  if (!digest) {
    throw new Error("invalid fixture policy");
  }
  const evidence: ReleasePolicyEvidence = {
    checks: [...policy.requiredChecks, ...policy.autoChecks].map((id) => ({
      id,
      state: "passed",
    })),
    ci: {
      checks: [
        {
          name: "CI Gate",
          producer: "github-actions",
          runId: "fixture-check-1",
          state: "passed",
        },
      ],
      proof: "exact-sha",
      testedSha: subject.sourceSha,
    },
    labels: ["publish:auto", "channel:stable", "release:minor"],
    noPublishReason: null,
    policyDigest: digest,
    publication: "unpublished",
    subject: { ...subject },
  };
  return { evidence, policy, subject };
};

export const refreshReleasePolicy = (
  fixture: ReturnType<typeof releaseFixture>
) => {
  const digest = releasePolicyDigest(fixture.policy);
  if (!digest) {
    throw new Error("invalid fixture policy");
  }
  fixture.evidence.policyDigest = digest;
};
