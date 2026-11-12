import { GITHUB_GHOST_LOGIN } from "./github-pull-request-types.ts";
import type { GitHubActor } from "./github-pull-request-types.ts";
import { wholeSecondUtc } from "./utc-instant.ts";

/** Names the field and what was expected. Never carries response content. */
export class GitHubResponseError extends Error {
  readonly path: string;

  constructor(path: string, expectation: string) {
    super(`${path}: expected ${expectation}`);
    this.name = "GitHubResponseError";
    this.path = path;
  }
}

export const fail = (path: string, expectation: string): never => {
  throw new GitHubResponseError(path, expectation);
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const present = (value: unknown): boolean =>
  value !== undefined && value !== null;

export const record = (value: unknown, path: string): Record<string, unknown> =>
  isRecord(value) ? value : fail(path, "an object");

export const list = (value: unknown, path: string): unknown[] =>
  Array.isArray(value) ? value : fail(path, "an array");

// `text` here and `identifier`, `commit` and `instant` below decide what a
// collection can put into a ledger entry. The validator's field rules in
// `review-ledger-entry.ts` (`name`, `identifier`, `commit`, `instant`) repeat
// them and must stay at least as wide: widening one of these requires widening
// the validator's too, or every ledger replace fails `entry-invalid`.
export const text = (value: unknown, path: string): string =>
  typeof value === "string" && value !== ""
    ? value
    : fail(path, "a nonempty string");

export const flag = (value: unknown, path: string): boolean =>
  typeof value === "boolean" ? value : fail(path, "a boolean");

export const identifier = (value: unknown, path: string): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fail(path, "a positive integer");

export const commit = (value: unknown, path: string): string =>
  typeof value === "string" && /^[\da-f]{40}$/u.test(value)
    ? value
    : fail(path, "a full lowercase commit ID");

export const instant = (value: unknown, path: string): string =>
  typeof value === "string" && wholeSecondUtc(value) !== null
    ? value
    : fail(path, "a whole-second UTC time");

/** GraphQL Actor exposes nullable identity and concrete User/Bot database IDs. */
export const graphQLActor = (
  value: unknown,
  path: string
): GitHubActor | null => {
  if (value === null) {
    return null;
  }
  const source = record(value, path);
  const type = text(source.__typename, `${path}.__typename`);
  if (type === "Mannequin") {
    return null;
  }
  if (type !== "User" && type !== "Bot") {
    return fail(`${path}.__typename`, "User or Bot");
  }
  const actor = {
    id: identifier(source.databaseId, `${path}.databaseId`),
    login: text(source.login, `${path}.login`),
    type,
  };
  return actor.login === GITHUB_GHOST_LOGIN ? null : actor;
};

export const each = <T>(
  value: unknown,
  path: string,
  parse: (item: unknown, itemPath: string) => T
): T[] =>
  list(value, path).map((item, index) => parse(item, `${path}[${index}]`));
