import { digest as sha256 } from "./check-config.ts";
import {
  array,
  choice,
  count,
  digest,
  invalid,
  object,
  text,
} from "./evidence-validation-primitives.ts";

export const FINDING_FORMATS = [
  "github-thread-v1",
  "codex-summary-v1",
  "devin-review-v1",
  "cursor-summary-v1",
  "linear-linkback-v1",
] as const;
export const FINDING_SURFACES = [
  "review",
  "issue-comment",
  "thread-comment",
] as const;

export interface FindingSource {
  reviewer: string;
  accountId: number;
  actorType: "Bot";
  formats: (typeof FINDING_FORMATS)[number][];
  surfaces: (typeof FINDING_SURFACES)[number][];
  externalCoverage: "qualified" | "unknown";
  qualificationRef: string | null;
}

/** Trusted policy declares the coverage claim. Its digest binds every accepted scope and resolution. */
export interface FindingSourcesPolicy {
  policyRevision: string;
  policyDigest: string;
  resolution: "github-native";
  sources: FindingSource[];
  unqualifiedSources: string[];
}

const uniqueStrings = (
  value: unknown,
  path: string,
  allowed?: readonly string[]
): string[] => {
  const entries = array(value, path).map((entry, index) => {
    const item = text(entry, `${path}[${index}]`);
    if (allowed !== undefined) {
      choice(item, `${path}[${index}]`, allowed);
    }
    return item;
  });
  if (new Set(entries).size !== entries.length) {
    invalid(path, "expected unique entries");
  }
  return entries.toSorted();
};

/** Validates before source reads, including when a direct collector caller passes a normalized policy. */
export const parseFindingSourcesPolicy = (
  value: unknown,
  path = "gatePolicy.findingSources"
): FindingSourcesPolicy => {
  const root = object(structuredClone(value), path, [
    "policyRevision",
    "policyDigest",
    "resolution",
    "sources",
    "unqualifiedSources",
  ]);
  digest(root.policyRevision, `${path}.policyRevision`, 40);
  choice(root.resolution, `${path}.resolution`, ["github-native"]);
  const reviewers = new Set<string>();
  const accounts = new Set<number>();
  const sources = array(root.sources, `${path}.sources`)
    .map((entry, index) => {
      const at = `${path}.sources[${index}]`;
      const source = object(entry, at, [
        "reviewer",
        "accountId",
        "actorType",
        "formats",
        "surfaces",
        "externalCoverage",
        "qualificationRef",
      ]);
      const reviewer = text(source.reviewer, `${at}.reviewer`);
      count(source.accountId, `${at}.accountId`);
      const accountId = source.accountId as number;
      if (accountId === 0 || accounts.has(accountId)) {
        invalid(`${at}.accountId`, "expected a unique positive account ID");
      }
      if (reviewers.has(reviewer)) {
        invalid(`${at}.reviewer`, "expected a unique reporting identity");
      }
      choice(source.actorType, `${at}.actorType`, ["Bot"]);
      const formats = uniqueStrings(
        source.formats,
        `${at}.formats`,
        FINDING_FORMATS
      );
      if (!formats.includes("github-thread-v1")) {
        invalid(`${at}.formats`, "native thread collection is required");
      }
      const surfaces = uniqueStrings(
        source.surfaces,
        `${at}.surfaces`,
        FINDING_SURFACES
      );
      if (surfaces.length !== FINDING_SURFACES.length) {
        invalid(
          `${at}.surfaces`,
          "all supported reporting surfaces are required"
        );
      }
      choice(source.externalCoverage, `${at}.externalCoverage`, [
        "qualified",
        "unknown",
      ]);
      const qualificationRef =
        source.qualificationRef === null
          ? null
          : text(source.qualificationRef, `${at}.qualificationRef`);
      if (
        source.externalCoverage === "qualified" &&
        qualificationRef === null
      ) {
        invalid(
          `${at}.qualificationRef`,
          "qualified coverage requires a record"
        );
      }
      reviewers.add(reviewer);
      accounts.add(accountId);
      return {
        accountId,
        actorType: "Bot" as const,
        externalCoverage:
          source.externalCoverage as FindingSource["externalCoverage"],
        formats: formats as FindingSource["formats"],
        qualificationRef,
        reviewer,
        surfaces: surfaces as FindingSource["surfaces"],
      };
    })
    .toSorted((left, right) => left.accountId - right.accountId);
  if (sources.length === 0) {
    invalid(`${path}.sources`, "expected at least one reporting source");
  }
  const config = {
    policyRevision: root.policyRevision as string,
    resolution: "github-native" as const,
    sources,
    unqualifiedSources: uniqueStrings(
      root.unqualifiedSources,
      `${path}.unqualifiedSources`
    ),
  };
  const policyDigest = sha256(JSON.stringify(config));
  if (
    Object.hasOwn(root, "policyDigest") &&
    root.policyDigest !== policyDigest
  ) {
    invalid(`${path}.policyDigest`, "must match the normalized source policy");
  }
  return { ...config, policyDigest };
};
