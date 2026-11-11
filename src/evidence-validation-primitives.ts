import type { ValidationIssue } from "./evidence-types.ts";

export class InvalidEvidenceError extends Error {
  readonly issue: ValidationIssue;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "InvalidEvidenceError";
    this.issue = { message, path };
  }
}

export const invalid = (path: string, message: string): never => {
  throw new InvalidEvidenceError(path, message);
};

export const object = (value: unknown, path: string, keys: string[]) => {
  if (
    value === null ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return invalid(path, "expected a JSON object");
  }
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (!keys.includes(key)) {
      invalid(`${path}.${key}`, "unsupported field");
    }
  }
  return result;
};

export const array = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) {
    return invalid(path, "expected an array");
  }
  return value;
};

export const text = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    return invalid(path, "expected a nonempty trimmed string");
  }
  return value;
};

export const choice = (
  value: unknown,
  path: string,
  choices: readonly unknown[]
) => {
  if (!choices.includes(value)) {
    invalid(path, `expected one of ${choices.join(", ")}`);
  }
};

export const count = (value: unknown, path: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(path, "expected a nonnegative safe integer");
  }
};

export const digest = (value: unknown, path: string, length: number) => {
  const result = text(value, path);
  if (result.length !== length || !/^[\da-f]+$/u.test(result)) {
    invalid(path, `expected ${length} lowercase hexadecimal characters`);
  }
};

export const repository = (value: unknown, path: string) => {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(text(value, path))) {
    invalid(path, "expected an explicit owner/repository identity");
  }
};

export const subject = (value: unknown, path: string, kind?: string) => {
  const result = object(value, path, [
    "kind",
    "repository",
    "headSha",
    "baseSha",
    "id",
  ]);
  choice(
    result.kind,
    `${path}.kind`,
    kind ? [kind] : ["pull_request", "merge_group"]
  );
  repository(result.repository, `${path}.repository`);
  digest(result.headSha, `${path}.headSha`, 40);
  digest(result.baseSha, `${path}.baseSha`, 40);
  if (result.kind === "pull_request") {
    count(result.id, `${path}.id`);
    if (result.id === 0) {
      invalid(`${path}.id`, "expected a positive PR number");
    }
  } else if ("id" in result) {
    invalid(`${path}.id`, "a candidate is not a PR");
  }
};

export const producer = (
  value: unknown,
  path: string,
  extra: string[] = []
) => {
  const result = object(value, path, [
    "producer",
    "runtimeFingerprint",
    ...extra,
  ]);
  text(result.producer, `${path}.producer`);
  digest(result.runtimeFingerprint, `${path}.runtimeFingerprint`, 64);
  return result;
};

export const provenance = (value: unknown, path: string) => {
  const result = producer(value, path, ["runId"]);
  text(result.runId, `${path}.runId`);
};
