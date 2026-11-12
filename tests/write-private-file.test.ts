import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { publish } from "../src/review-ledger-files.ts";
import { writePrivateFile } from "../src/write-private-file.ts";
import { fixture, run } from "./check-fixtures.ts";

const helper = path.resolve(import.meta.dir, "../src/write-private-file.ts");
const NAME = "record.json";
const UUID = "[\\da-f]{8}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{12}";
/** The documented temporary name: the file's own, a random UUID and `.tmp`. */
const temporaryName = (name: string) =>
  new RegExp(`^${name.replaceAll(".", "\\.")}\\.${UUID}\\.tmp$`, "u");
/** Owner-only modes cannot be asserted where the platform has no such modes. */
const NO_MODES = process.platform === "win32";

const roots: string[] = [];
const scratch = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "forge-private-file-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const names = (directory: string): string[] =>
  readdirSync(directory).toSorted();
const mode = (file: string): number => statSync(file).mode % 0o1000;

/** The system's name for what a rejected write failed with. */
const failure = async (attempt: Promise<void>): Promise<unknown> => {
  try {
    await attempt;
  } catch (error) {
    return error instanceof Error && "code" in error ? error.code : error;
  }
  throw new Error("expected the write to be rejected");
};

test.each(["leave-temporary", "remove-temporary"] as const)(
  "with %s, a write puts the text at the file and leaves nothing beside it",
  async (onFailure) => {
    const directory = scratch();
    const file = path.join(directory, NAME);
    await writePrivateFile(file, "first\n", onFailure);
    expect(readFileSync(file, "utf-8")).toBe("first\n");
    await writePrivateFile(file, "second\n", onFailure);
    expect(readFileSync(file, "utf-8")).toBe("second\n");
    expect(names(directory)).toEqual([NAME]);
  }
);

test.skipIf(NO_MODES)(
  "the file is owner-only, whatever the file it replaces allowed",
  async () => {
    const file = path.join(scratch(), NAME);
    await writePrivateFile(file, "first\n", "leave-temporary");
    expect(mode(file)).toBe(0o600);
    chmodSync(file, 0o644);
    await writePrivateFile(file, "second\n", "leave-temporary");
    expect(mode(file)).toBe(0o600);
  }
);

test("a write puts a new file in place and never writes into the old one", async () => {
  const directory = scratch();
  const file = path.join(directory, NAME);
  writeFileSync(file, "old\n");
  // A second name for the same file: writing in place would change it too.
  linkSync(file, path.join(directory, "held"));
  await writePrivateFile(file, "new\n", "remove-temporary");
  expect(readFileSync(path.join(directory, "held"), "utf-8")).toBe("old\n");
  expect(readFileSync(file, "utf-8")).toBe("new\n");
  expect(names(directory)).toEqual(["held", NAME]);
});

// A directory at the file's name is one thing no rename replaces with a file,
// so the temporary file is written and the rename then fails.

test("with remove-temporary, a failed rename rejects with the system's error and leaves no temporary file", async () => {
  const directory = scratch();
  const file = path.join(directory, NAME);
  mkdirSync(file);
  expect(
    await failure(writePrivateFile(file, "text\n", "remove-temporary"))
  ).toBe("EISDIR");
  expect(names(directory)).toEqual([NAME]);
  expect(names(file)).toEqual([]);
});

test("the ledger publisher removes its temporary file after a failed rename", async () => {
  const directory = scratch();
  const file = path.join(directory, NAME);
  mkdirSync(file);
  await expect(publish(file, "text\n")).rejects.toMatchObject({
    code: "ledger-unavailable",
    message: "could not write the entry: EISDIR",
  });
  expect(names(directory)).toEqual([NAME]);
  expect(names(file)).toEqual([]);
});

test.skipIf(NO_MODES || process.getuid?.() === 0)(
  "with remove-temporary, a refused write preserves its error when cleanup is refused too",
  async () => {
    const directory = scratch();
    const file = path.join(directory, NAME);
    chmodSync(directory, 0o500);
    try {
      expect(
        await failure(writePrivateFile(file, "text\n", "remove-temporary"))
      ).toBe("EACCES");
      expect(names(directory)).toEqual([]);
    } finally {
      chmodSync(directory, 0o700);
    }
  }
);

test("with leave-temporary, a failed rename rejects with the system's error and leaves the temporary file", async () => {
  const directory = scratch();
  const file = path.join(directory, NAME);
  mkdirSync(file);
  expect(
    await failure(writePrivateFile(file, "text\n", "leave-temporary"))
  ).toBe("EISDIR");
  const [kept = "", ...rest] = names(directory).filter((name) => name !== NAME);
  expect(rest).toEqual([]);
  expect(kept).toMatch(temporaryName(NAME));
  expect(readFileSync(path.join(directory, kept), "utf-8")).toBe("text\n");
  expect(names(file)).toEqual([]);
});

// The temporary name is random, so only a process whose UUIDs are fixed can
// put something in its way. That process is a child, as in `cli.test.ts`.
test("the temporary file is created exclusively, so nothing already at its name is written through", () => {
  const directory = scratch();
  const file = path.join(directory, NAME);
  const fixed = "00000000-0000-4000-8000-000000000000";
  const elsewhere = path.join(directory, "elsewhere");
  writeFileSync(elsewhere, "kept\n");
  symlinkSync(elsewhere, `${file}.${fixed}.tmp`);
  const preload = path.join(directory, "fixed-uuid.ts");
  // Both scripts are fixed text. What varies reaches them through the
  // environment, so no value is ever written into code.
  writeFileSync(
    preload,
    'import {mock} from "bun:test"; import * as actual from "node:crypto"; const original = {...actual}; mock.module("node:crypto", () => ({...original, randomUUID: () => process.env.FIXED_UUID}));'
  );
  const script = path.join(directory, "write.ts");
  writeFileSync(
    script,
    'const {writePrivateFile} = await import(process.env.HELPER); try { await writePrivateFile(process.env.TARGET, "new\\n", "leave-temporary"); console.log("written"); } catch (error) { console.log(error.code); }'
  );
  const child = Bun.spawnSync(
    [process.execPath, "--preload", preload, script],
    {
      env: { FIXED_UUID: fixed, HELPER: helper, TARGET: file },
    }
  );
  expect(child.stdout.toString().trim()).toBe("EEXIST");
  expect(readFileSync(elsewhere, "utf-8")).toBe("kept\n");
  expect(existsSync(file)).toBe(false);
});

// `forge check` leaves the temporary file of a record it could not publish.
// Removing it would be a change to what `forge check` does on failure.
test("forge check leaves the temporary file of a final record it could not rename into place", () => {
  const root = fixture(
    'const fs=require("fs"); const [id]=fs.readdirSync(".git/forge-check"); const file=".git/forge-check/"+id+"/receipt.json"; fs.rmSync(file); fs.mkdirSync(file)'
  );
  roots.push(root);
  const result = run(root);
  expect(result.code).toBe(3);
  expect(result.receipt).toMatchObject({
    diagnostic: "receipt-write-failed",
    exitCode: 0,
    outcome: "passed",
    recording: { path: null, state: "failed" },
  });
  const directory = path.join(
    root,
    ".git",
    "forge-check",
    result.receipt.receiptId
  );
  const [kept = "", ...rest] = names(directory).filter(
    (name) => name !== "receipt.json"
  );
  expect(rest).toEqual([]);
  expect(kept).toMatch(temporaryName("receipt.json"));
  expect(
    JSON.parse(readFileSync(path.join(directory, kept), "utf-8"))
  ).toMatchObject({ outcome: "passed", receiptId: result.receipt.receiptId });
});
