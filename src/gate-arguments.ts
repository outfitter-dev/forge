import path from "node:path";

import type { ValidationIssue } from "./evidence-types.ts";

export const GATE_SYNOPSIS =
  "forge gate --repository <owner/name> --pull-request <number> --policy <file> --state <directory> --run-id <id> [--receipt <file>]... [--review-evidence <file>] [--expected-head <commit> --expected-base <commit>] [--output-version <1|2>]";
export const GATE_USAGE = `Usage: ${GATE_SYNOPSIS}`;

export interface GateArguments {
  /** `owner/name`, in the form the GitHub reads and the ledger store accept. */
  repository: string;
  pullRequest: number;
  /** The gate policy file, as given. */
  policy: string;
  /** The absolute state directory, as given. */
  state: string;
  runId: string;
  /** One file per `--receipt` flag, in the order given. */
  receipts: string[];
  reviewEvidence: string | null;
  /** Trusted admission's exact subject, checked before storing collected state. */
  expectedRevision: { headSha: string; baseSha: string } | null;
}

export type GateArgumentsResult =
  | { valid: true; arguments: GateArguments }
  | { valid: false; issues: ValidationIssue[] };

const REQUIRED = [
  "--repository",
  "--pull-request",
  "--policy",
  "--state",
  "--run-id",
] as const;
const FLAGS = new Set<string>([
  ...REQUIRED,
  "--receipt",
  "--review-evidence",
  "--expected-head",
  "--expected-base",
  "--output-version",
]);

/**
 * Every flag with the values it was given. An argument that is not a known
 * flag ends the reading, since what follows it cannot be paired. Its issue
 * names its position and never repeats it: a stray argument can be anything,
 * a credential included.
 */
const read = (args: string[]) => {
  const given = new Map<string, string[]>();
  const issues: ValidationIssue[] = [];
  let index = 0;
  while (index < args.length) {
    const flag = args[index] ?? "";
    if (!FLAGS.has(flag)) {
      issues.push({
        message: "not a known flag",
        path: `arguments[${index}]`,
      });
      return { given, issues };
    }
    const value = args[index + 1];
    // A value is never itself a flag: `--run-id --receipt` names no run.
    const present = value !== undefined && !value.startsWith("--");
    if (!present) {
      issues.push({ message: "expected a value", path: flag });
    } else if (given.has(flag) && flag !== "--receipt") {
      issues.push({ message: "given more than once", path: flag });
    }
    given.set(flag, [...(given.get(flag) ?? []), ...(present ? [value] : [])]);
    index += present ? 2 : 1;
  }
  for (const flag of REQUIRED) {
    if (!given.has(flag)) {
      issues.push({ message: "required", path: flag });
    }
  }
  return { given, issues };
};

const isTrimmedText = (value: string): boolean =>
  value !== "" && value.trim() === value;

/** Neither part is `.` or `..`: the GitHub reads and the ledger store refuse both. */
const isRepository = (value: string): boolean =>
  /^[\w.-]+\/[\w.-]+$/u.test(value) &&
  value.split("/").every((part) => part !== "." && part !== "..");

/** A decimal with no sign, leading zero, fraction or exponent. */
const pullRequestNumber = (value: string): number | null => {
  const number = /^[1-9]\d*$/u.test(value) ? Number(value) : null;
  return number !== null && Number.isSafeInteger(number) ? number : null;
};

/**
 * Reads the arguments after `gate`. Every flag takes one value. A missing
 * required flag, an unknown flag, a repeated flag other than `--receipt`, a
 * flag without a value and a value of the wrong form are all issues; an issue
 * names the flag and never repeats what was given. Nothing is read from disk.
 */
export const parseGateArguments = (args: string[]): GateArgumentsResult => {
  const { given, issues } = read(args);
  if (issues.length > 0) {
    return { issues, valid: false };
  }
  const one = (flag: string): string => given.get(flag)?.[0] ?? "";
  if (
    given.has("--output-version") &&
    !["1", "2"].includes(one("--output-version"))
  ) {
    issues.push({ message: "expected 1 or 2", path: "--output-version" });
  }
  const repository = one("--repository");
  const pullRequest = pullRequestNumber(one("--pull-request"));
  const state = one("--state");
  const runId = one("--run-id");
  const expectsRevision =
    given.has("--expected-head") || given.has("--expected-base");
  if (expectsRevision) {
    for (const flag of ["--expected-head", "--expected-base"]) {
      if (!/^[\da-f]{40}$/u.test(one(flag))) {
        issues.push({
          message: "expected a full lowercase commit ID",
          path: flag,
        });
      }
    }
  }
  if (!isRepository(repository)) {
    issues.push({ message: "expected owner/name", path: "--repository" });
  }
  if (pullRequest === null) {
    issues.push({
      message: "expected a positive integer",
      path: "--pull-request",
    });
  }
  if (!path.isAbsolute(state)) {
    issues.push({ message: "expected an absolute path", path: "--state" });
  }
  if (!isTrimmedText(runId)) {
    issues.push({
      message: "expected a nonempty trimmed string",
      path: "--run-id",
    });
  }
  if (pullRequest === null || issues.length > 0) {
    return { issues, valid: false };
  }
  return {
    arguments: {
      expectedRevision: expectsRevision
        ? { baseSha: one("--expected-base"), headSha: one("--expected-head") }
        : null,
      policy: one("--policy"),
      pullRequest,
      receipts: given.get("--receipt") ?? [],
      repository,
      reviewEvidence: given.get("--review-evidence")?.[0] ?? null,
      runId,
      state,
    },
    valid: true,
  };
};
