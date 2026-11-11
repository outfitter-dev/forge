import type {
  GeneratedReleaseDiffDecision,
  GeneratedReleaseDiffEvidence,
  GeneratedReleaseDiffPolicy,
  GeneratedReleaseDiffSubject,
} from "./generated-release-diff-types.ts";
import {
  generatedReleaseDiffPolicyDigest,
  validDiffEvidence,
  validDiffSubject,
} from "./generated-release-diff-validation.ts";

const diffDiagnostics = (
  policy: GeneratedReleaseDiffPolicy,
  files: GeneratedReleaseDiffEvidence["files"]
): string[] => {
  const manifests = new Map(
    policy.packages.map((pkg) => [pkg.manifestPath, pkg.name])
  );
  const changelogs = new Map(
    policy.packages.map((pkg) => [pkg.changelogPath, pkg.name])
  );
  const changesets = new Set(policy.changesetPaths);
  const modifiedManifests = new Set<string>();
  const modifiedChangelogs = new Set<string>();
  let sawChangesetDeletion = false;
  const diagnostics: string[] = [];
  for (const file of files) {
    const manifestName = manifests.get(file.path);
    if (manifestName && file.status === "M") {
      modifiedManifests.add(manifestName);
      continue;
    }
    const changelogName = changelogs.get(file.path);
    if (changelogName && file.status === "M") {
      modifiedChangelogs.add(changelogName);
      continue;
    }
    if (changesets.has(file.path) && file.status === "D") {
      sawChangesetDeletion = true;
      continue;
    }
    diagnostics.push(
      `Unexpected release diff entry: ${file.status} ${file.path}`
    );
  }
  for (const name of modifiedManifests) {
    if (!modifiedChangelogs.has(name)) {
      diagnostics.push(`${name} modified its manifest without its changelog`);
    }
  }
  for (const name of modifiedChangelogs) {
    if (!modifiedManifests.has(name)) {
      diagnostics.push(`${name} modified its changelog without its manifest`);
    }
  }
  if (modifiedManifests.size === 0) {
    diagnostics.push(
      "Generated release diff did not modify any package manifest"
    );
  }
  if (!sawChangesetDeletion) {
    diagnostics.push(
      "Generated release diff did not delete an allowed changeset"
    );
  }
  return diagnostics;
};

/** Adapted from release-action's manifest/changelog set check. No file content, Git or publishing effects. */
export const evaluateGeneratedReleaseDiff = (
  subject: GeneratedReleaseDiffSubject,
  policy: GeneratedReleaseDiffPolicy,
  evidence: GeneratedReleaseDiffEvidence
): GeneratedReleaseDiffDecision => {
  const policyDigest = generatedReleaseDiffPolicyDigest(policy);
  if (policyDigest === null || !validDiffSubject(subject)) {
    return { binding: null, decision: "block", diagnostics: ["invalid-input"] };
  }
  const binding = { ...subject, policyDigest };
  const report = (diagnostics: string[]): GeneratedReleaseDiffDecision => ({
    binding,
    decision: diagnostics.length ? "block" : "pass",
    diagnostics,
  });
  if (!validDiffEvidence(evidence)) {
    return report(["invalid-evidence"]);
  }
  if (policy.repository !== subject.repository) {
    return report(["repository-policy-mismatch"]);
  }
  if (
    evidence.policyDigest !== policyDigest ||
    (Object.keys(subject) as (keyof GeneratedReleaseDiffSubject)[]).some(
      (key) => subject[key] !== evidence.subject[key]
    )
  ) {
    return report(["stale-evidence"]);
  }
  if (evidence.state !== "complete") {
    return report([`diff-${evidence.state}`]);
  }

  return report(diffDiagnostics(policy, evidence.files));
};
