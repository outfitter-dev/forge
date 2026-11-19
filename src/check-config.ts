import { createHash } from "node:crypto";
import { constants, open, readFile } from "node:fs/promises";

import type { ProjectConfig } from "./check-types.ts";

export const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]): boolean =>
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[\w./-]{1,200}$/u.test(value);

export const readRegularConfig = async (file: string): Promise<Buffer> => {
  const handle = await open(
    file,
    // oxlint-disable-next-line eslint/no-bitwise
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error("Expected a regular project configuration file");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
};

export const readConfig = async (
  file: string,
  requireRegular = false
): Promise<{ config: ProjectConfig; identity: string }> => {
  const bytes = await (requireRegular
    ? readRegularConfig(file)
    : readFile(file));
  const value: unknown = JSON.parse(bytes.toString());
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "repository", "check"]) ||
    value.schemaVersion !== 1 ||
    !identifier(value.repository) ||
    !object(value.check) ||
    !keys(value.check, ["id", "command"]) ||
    !identifier(value.check.id) ||
    !Array.isArray(value.check.command) ||
    value.check.command.length === 0 ||
    value.check.command.length > 128 ||
    !value.check.command.every(
      (arg: unknown) =>
        typeof arg === "string" && arg.length <= 8192 && !arg.includes("\0")
    ) ||
    value.check.command[0] === ""
  ) {
    throw new Error("Invalid project configuration");
  }
  return { config: value as unknown as ProjectConfig, identity: digest(bytes) };
};
