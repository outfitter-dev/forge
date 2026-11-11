import type {
  ReleasePolicy,
  ReleasePolicyDecision,
  ReleasePolicyEvidence,
  ReleaseSubject,
} from "./release-policy-types.ts";
import {
  releasePolicyDigest,
  validReleaseEvidence,
  validReleaseSubject,
} from "./release-policy-validation.ts";

const publishLabels = [
  "publish:auto",
  "publish:manual",
  "publish:none",
  "publish:block",
];

/** Adapted from release-action's ordered intent-family classification; only declared values may select a branch. */
const labelFamily = (labels: string[], prefix: string, allowed: string[]) => {
  const matched = labels.filter((label) => label.startsWith(prefix));
  const unknown = matched.filter((label) => !allowed.includes(label));
  return {
    blockers: [
      ...(unknown.length ? [`unknown-intent:${prefix}`] : []),
      ...(matched.filter((label) => allowed.includes(label)).length > 1
        ? [`conflicting-intent:${prefix}`]
        : []),
    ],
    value: matched.find((label) => allowed.includes(label)),
  };
};

const sameSubject = (expected: ReleaseSubject, actual: ReleaseSubject) =>
  (Object.keys(expected) as (keyof ReleaseSubject)[]).every(
    (key) => expected[key] === actual[key]
  );

const unexpectedChecks = (
  policy: ReleasePolicy,
  evidence: ReleasePolicyEvidence
) => {
  const declared = new Set([...policy.requiredChecks, ...policy.autoChecks]);
  return evidence.checks.some((check) => !declared.has(check.id))
    ? ["unexpected-check-evidence"]
    : [];
};

const checkReasons = (policy: ReleasePolicy, evidence: ReleasePolicyEvidence) =>
  policy.requiredChecks.flatMap((id) => {
    const check = evidence.checks.find((item) => item.id === id);
    return check?.state === "passed"
      ? []
      : [`required-check:${id}:${check?.state ?? "missing"}`];
  });

const ciReasons = (
  subject: ReleaseSubject,
  policy: ReleasePolicy,
  evidence: ReleasePolicyEvidence
) => {
  const { ci } = evidence;
  if (ci === null) {
    return ["missing-ci-proof"];
  }
  if (ci.proof !== "exact-sha") {
    return ["unsupported-ci-proof"];
  }
  if (ci.testedSha !== subject.sourceSha) {
    return ["stale-ci-proof"];
  }
  return policy.ciChecks.flatMap((required) => {
    const found = ci.checks.find(
      (check) =>
        check.name === required.name && check.producer === required.producer
    );
    return found?.state === "passed"
      ? []
      : [`required-ci:${required.name}:${found?.state ?? "missing"}`];
  });
};

const autoDiagnostics = (
  policy: ReleasePolicy,
  evidence: ReleasePolicyEvidence,
  channel: ReleasePolicy["channels"][number] | undefined
) => {
  const diagnostics = policy.autoChecks.flatMap((id) => {
    const check = evidence.checks.find((item) => item.id === id);
    return check?.state === "passed"
      ? []
      : [`auto-check:${id}:${check?.state ?? "missing"}`];
  });
  if (!channel?.autoAllowed) {
    diagnostics.push("channel-not-auto-eligible");
  }
  return diagnostics;
};

/** Pure intent routing and requirement accounting. No provider, subprocess, approval or publishing authority. */
export const evaluateReleasePolicy = (
  subject: ReleaseSubject,
  policy: ReleasePolicy,
  evidence: ReleasePolicyEvidence
): ReleasePolicyDecision => {
  const digest = releasePolicyDigest(policy);
  if (digest === null || !validReleaseSubject(subject)) {
    return {
      binding: null,
      blockers: ["invalid-input"],
      decision: "block",
      diagnostics: [],
      reasons: [],
    };
  }
  const binding = { ...subject, policyDigest: digest };
  const report = (
    decision: ReleasePolicyDecision["decision"],
    blockers: string[] = [],
    diagnostics: string[] = [],
    reasons: string[] = []
  ): ReleasePolicyDecision => ({
    binding,
    blockers,
    decision,
    diagnostics,
    reasons,
  });
  if (!validReleaseEvidence(evidence)) {
    return report("block", ["invalid-evidence"]);
  }
  if (
    !sameSubject(subject, evidence.subject) ||
    evidence.policyDigest !== digest
  ) {
    return report("block", ["stale-evidence"]);
  }
  if (subject.repository !== policy.repository || subject.ref !== policy.ref) {
    return report("block", ["release-context-mismatch"]);
  }
  if (!policy.channels.some((channel) => channel.tag === subject.tag)) {
    return report("block", ["unsupported-tag"]);
  }

  const publish = labelFamily(evidence.labels, "publish:", publishLabels);
  const channel = labelFamily(
    evidence.labels,
    "channel:",
    policy.channels.map((item) => item.label)
  );
  const release = labelFamily(
    evidence.labels,
    "release:",
    policy.releaseLabels
  );
  const blockers = [
    ...publish.blockers,
    ...channel.blockers,
    ...release.blockers,
    ...unexpectedChecks(policy, evidence),
  ];
  if (["partial", "conflict", "unavailable"].includes(evidence.publication)) {
    blockers.push(`publication-${evidence.publication}`);
  }
  if (publish.value === "publish:block") {
    blockers.push("publish-block");
  }
  const selectedChannel = policy.channels.find(
    (item) => item.label === channel.value
  );
  if (selectedChannel && selectedChannel.tag !== subject.tag) {
    blockers.push("channel-tag-mismatch");
  }
  if (blockers.length) {
    return report("block", blockers);
  }
  if (publish.value === "publish:none") {
    return evidence.noPublishReason === null
      ? report("block", ["missing-skip-reason"])
      : report("none", [], [], ["audited-publish-none"]);
  }

  // Safety evidence is required for manual as well as automatic eligibility; approval cannot waive it.
  const required = [
    ...checkReasons(policy, evidence),
    ...ciReasons(subject, policy, evidence),
  ];
  if (required.length) {
    return report("block", required);
  }
  if (publish.value !== "publish:auto") {
    return report(
      "manual",
      [],
      [],
      [
        publish.value === "publish:manual"
          ? "explicit-manual"
          : "missing-publish-intent",
      ]
    );
  }
  const diagnostics = autoDiagnostics(policy, evidence, selectedChannel);
  if (diagnostics.length) {
    return report("manual", [], diagnostics, ["automatic-eligibility-unmet"]);
  }
  return report("auto", [], [], ["automatic-eligibility-met"]);
};
