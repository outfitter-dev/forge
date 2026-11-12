import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import type { ValidationIssue } from "./evidence-types.ts";
import {
  invalid,
  InvalidEvidenceError,
  object,
} from "./evidence-validation-primitives.ts";
import type { GateArguments } from "./gate-arguments.ts";
import { parseGatePolicy } from "./gate-policy.ts";
import type { GatePolicy } from "./gate-policy.ts";

/** The one place the GitHub token is read from. */
export const TOKEN_VARIABLE = "FORGE_GITHUB_TOKEN";

/** The form the GitHub reads accept: visible ASCII with no spaces. */
const TOKEN = /^[!-~]+$/u;

const REVIEW_KEYS = ["agentReviews", "reviewFindings", "reviewLadder"] as const;

/** The three evaluator fields of a version 2 pull request; the evaluator validates their content. */
export type ReviewEvidence = Record<(typeof REVIEW_KEYS)[number], unknown>;

export interface GateInputs {
  policy: GatePolicy;
  /** One decoded receipt per `--receipt` flag, in the order given. */
  receipts: unknown[];
  reviewEvidence: ReviewEvidence;
  token: string;
}

export type GateInputsResult =
  | { valid: true; inputs: GateInputs }
  | { valid: false; issues: ValidationIssue[] };

const refused = (path_: string, message: string): GateInputsResult => ({
  issues: [{ message, path: path_ }],
  valid: false,
});

/** No review evidence: the agent-review gate then fails for lack of it. */
const noReviewEvidence = (): ReviewEvidence => ({
  agentReviews: [],
  reviewFindings: { findings: [], recorded: false },
  reviewLadder: null,
});

/**
 * `target` with the symlinks in the part of it that exists resolved, and the
 * rest kept as written. The state directory need not exist yet.
 */
const canonical = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    const parent = path.dirname(target);
    return parent === target
      ? target
      : path.join(await canonical(parent), path.basename(target));
  }
};

/** Whether `child` is `parent` or anywhere below it. */
const isWithin = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

/**
 * Whether `target`, or any directory on the way to it, is in `workspace`. A
 * path that enters the workspace and leaves it again through a symlink counts:
 * whoever can write the workspace can point that symlink somewhere else.
 */
const passesThrough = async (
  workspace: string,
  target: string
): Promise<boolean> => {
  if (isWithin(workspace, await canonical(target))) {
    return true;
  }
  const parent = path.dirname(target);
  return parent === target ? false : passesThrough(workspace, parent);
};

/** A parser's message quotes the text it failed on, so nothing of the failure is kept. */
const readJson = async (
  cwd: string,
  file: string
): Promise<{ readable: true; value: unknown } | { readable: false }> => {
  try {
    const value: unknown = JSON.parse(
      await readFile(path.resolve(cwd, file), "utf-8")
    );
    return { readable: true, value };
  } catch {
    return { readable: false };
  }
};
const UNREADABLE = "unable to read the file or parse it as JSON";

const checked = <T>(
  parse: () => T
): { value: T } | { issue: ValidationIssue } => {
  try {
    return { value: parse() };
  } catch (error) {
    if (error instanceof InvalidEvidenceError) {
      return { issue: error.issue };
    }
    throw error;
  }
};

const reviewEvidence = (value: unknown): ReviewEvidence => {
  const result = object(value, "reviewEvidence", [...REVIEW_KEYS]);
  for (const key of REVIEW_KEYS) {
    if (!Object.hasOwn(result, key)) {
      invalid(`reviewEvidence.${key}`, "required");
    }
  }
  return {
    agentReviews: result.agentReviews,
    reviewFindings: result.reviewFindings,
    reviewLadder: result.reviewLadder,
  };
};

/**
 * Everything `forge gate` takes in beside its arguments: the token from the
 * environment, and the policy, receipt and review-evidence files. It also
 * refuses a state directory in the working directory. The first thing that is
 * not as required is the one issue returned; an issue names a variable, a flag
 * or a field, and never holds a value, a file's content or a path on disk.
 * It reads the named files and resolves symlinks, and touches nothing else:
 * no request is made and nothing is read from or created in the state directory.
 */
export const readGateInputs = async (
  args: GateArguments,
  env: Record<string, string | undefined>,
  cwd: string
): Promise<GateInputsResult> => {
  // Bun can log Authorization headers before the transport can redact them.
  if (Object.keys(env).includes("BUN_CONFIG_VERBOSE_FETCH")) {
    return refused("BUN_CONFIG_VERBOSE_FETCH", "must be unset");
  }
  const token = env[TOKEN_VARIABLE];
  if (token === undefined || !TOKEN.test(token)) {
    return refused(TOKEN_VARIABLE, "expected a token of visible ASCII");
  }
  // State must not live in a checkout or a job workspace: proposed code could
  // write it, and cleaning the workspace would delete it.
  if (await passesThrough(await canonical(cwd), path.resolve(args.state))) {
    return refused("--state", "must not be the working directory or inside it");
  }
  const policyFile = await readJson(cwd, args.policy);
  if (!policyFile.readable) {
    return refused("--policy", UNREADABLE);
  }
  const policy = checked(() => parseGatePolicy(policyFile.value));
  if ("issue" in policy) {
    return { issues: [policy.issue], valid: false };
  }
  if (policy.value.evidence.repository !== args.repository) {
    return refused(
      "--repository",
      "must equal the policy's evidence.repository exactly"
    );
  }
  const receipts = await Promise.all(
    args.receipts.map((file) => readJson(cwd, file))
  );
  const values: unknown[] = [];
  for (const [index, file] of receipts.entries()) {
    if (!file.readable) {
      return refused(`--receipt[${index}]`, UNREADABLE);
    }
    values.push(file.value);
  }
  let review = noReviewEvidence();
  if (args.reviewEvidence !== null) {
    const reviewFile = await readJson(cwd, args.reviewEvidence);
    if (!reviewFile.readable) {
      return refused("--review-evidence", UNREADABLE);
    }
    const parsed = checked(() => reviewEvidence(reviewFile.value));
    if ("issue" in parsed) {
      return { issues: [parsed.issue], valid: false };
    }
    review = parsed.value;
  }
  return {
    inputs: {
      policy: policy.value,
      receipts: values,
      reviewEvidence: review,
      token,
    },
    valid: true,
  };
};
