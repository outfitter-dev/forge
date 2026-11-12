import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";

import {
  collectPullRequest,
  emptyReviewLedgerEntry,
  readReviewLedger,
  replaceReviewLedger,
  ReviewLedgerError,
} from "../src/index.ts";
import type {
  PullRequestReads,
  ReviewLedgerEntry,
  ReviewLedgerLocation,
} from "../src/index.ts";
import { provenance, REPOSITORY } from "./evidence-fixtures.ts";
import {
  BASE,
  HEAD,
  pullRequestResponse,
  reviewRequestedEvent,
  reviewResponse,
  threadPageResponse,
} from "./github-fixtures.ts";

const OTHER = "c".repeat(40);
const SNAPSHOT_AT = "2026-01-01T00:00:00Z";
const SUBMITTED_AT = "2026-01-01T00:10:00Z";
const BEFORE_NOW = "2026-01-01T00:59:59Z";
const NOW = "2026-01-01T01:00:00Z";
const AFTER_NOW = "2026-01-01T01:00:01Z";
const LONG_AFTER_NOW = "2026-01-01T02:00:00Z";
/** A time no entry in these tests is ahead of. */
const LATE = "2999-12-31T23:59:59Z";
/**
 * Stands for content that must never reach an error message. It is one token,
 * so a parser that quotes the word it stopped at quotes all of it.
 */
const MARKER = "privateLedgerMarker";

/** The documented names for `example/project` number 12. */
const ENTRY = "example+project+12.json";
const LOCK = "example+project+12.lock";
const BUSY = `${LOCK} exists: another replace holds it, or one that stopped left it behind`;

/** Owner-only modes cannot be asserted where the platform has no such modes. */
const NO_MODES = process.platform === "win32";
/** An administrator reads a file whatever its mode says. */
const READS_ANYTHING = NO_MODES || process.getuid?.() === 0;
/** A named pipe is made with the `mkfifo` command; without it those tests are skipped. */
const NO_PIPES = Bun.which("mkfifo") === null;

const roots: string[] = [];
const pipes: string[] = [];
/** A state directory that does not exist yet, inside a directory the test removes. */
const state = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "forge-ledger-"));
  roots.push(root);
  return path.join(root, "state");
};
afterEach(() => {
  for (const pipe of pipes.splice(0)) {
    // If an open is still waiting on the pipe, a writer lets it finish, so a
    // regression fails its test by timeout and does not hold the process.
    try {
      // oxlint-disable-next-line no-bitwise -- open flags are a bit set
      closeSync(openSync(pipe, constants.O_WRONLY | constants.O_NONBLOCK));
    } catch {
      // Nothing was waiting, which is the expected case.
    }
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const location = (
  directory: string,
  overrides: Partial<ReviewLedgerLocation> = {}
): ReviewLedgerLocation => ({
  directory,
  pullRequest: 12,
  repository: "example/project",
  ...overrides,
});

const read = (
  directory: string,
  now = NOW,
  overrides: Partial<ReviewLedgerLocation> = {}
): Promise<ReviewLedgerEntry> =>
  readReviewLedger({ ...location(directory, overrides), now });

const replace = (
  directory: string,
  expected: ReviewLedgerEntry,
  next: ReviewLedgerEntry,
  overrides: Partial<ReviewLedgerLocation> = {}
): Promise<"stored" | "conflict"> =>
  replaceReviewLedger(location(directory, overrides), expected, next);

const entry = (
  overrides: Partial<ReviewLedgerEntry> = {}
): ReviewLedgerEntry => ({
  observedRevision: { baseSha: BASE, headSha: HEAD, observedAt: SNAPSHOT_AT },
  requiredReviewers: [
    { id: 31, kind: "team", slug: "maintainers" },
    { id: 7, kind: "user", login: "reviewer" },
  ],
  reviewBindings: {
    "900": {
      baseSha: BASE,
      headSha: HEAD,
      observedAt: SNAPSHOT_AT,
      submittedAt: SUBMITTED_AT,
    },
  },
  ...overrides,
});

const other = (): ReviewLedgerEntry =>
  entry({ requiredReviewers: [{ id: 5, kind: "user", login: "earlier" }] });

const boundAt = (observedAt: string, submittedAt: string) => ({
  baseSha: BASE,
  headSha: HEAD,
  observedAt,
  submittedAt,
});

const rejection = async (attempt: Promise<unknown>): Promise<unknown> => {
  try {
    await attempt;
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to be rejected");
};

const ledgerError = async (
  attempt: Promise<unknown>
): Promise<ReviewLedgerError> => {
  const error = await rejection(attempt);
  if (error instanceof ReviewLedgerError) {
    return error;
  }
  throw error;
};

/** What the state directory holds; nothing if it does not exist. */
const names = (directory: string): string[] =>
  existsSync(directory) ? readdirSync(directory).toSorted() : [];
const bytes = (directory: string, name = ENTRY): Buffer =>
  readFileSync(path.join(directory, name));
const mode = (file: string): number => statSync(file).mode % 0o1000;

/** A state directory that already holds `contents` as the entry. */
const seeded = (contents: string | Uint8Array): string => {
  const directory = state();
  mkdirSync(directory);
  writeFileSync(path.join(directory, ENTRY), contents);
  return directory;
};

/** A state directory whose entry was stored by the store itself. */
const holding = async (stored: ReviewLedgerEntry): Promise<string> => {
  const directory = state();
  expect(await replace(directory, emptyReviewLedgerEntry(), stored)).toBe(
    "stored"
  );
  return directory;
};

const CORRUPTED = [
  { contents: `{"requiredReviewers": [${MARKER}`, name: "is not JSON" },
  { contents: "", name: "is empty" },
  { contents: "null", name: "holds null" },
  {
    contents: JSON.stringify({ ...entry(), [MARKER]: true }),
    name: "has an unknown field",
  },
  {
    contents: JSON.stringify({ requiredReviewers: [] }),
    name: "is missing fields",
  },
  {
    contents: JSON.stringify(
      entry({
        reviewBindings: { "900": boundAt(SUBMITTED_AT, SUBMITTED_AT) },
      })
    ),
    name: "holds a binding observed when it was submitted",
  },
  {
    contents: Uint8Array.from([
      ...Buffer.from('{"observedRevision":null,"requiredReviewers":[{"id":7,'),
      ...Buffer.from('"kind":"user","login":"'),
      0xff,
      ...Buffer.from('"}],"reviewBindings":{}}'),
    ]),
    name: "is not UTF-8",
  },
];

const BAD_REPOSITORIES = [
  "./x",
  "../x",
  "x/..",
  "x/.",
  "./..",
  "a/b/c",
  "a",
  "a/",
  "/a",
  "",
  String.raw`a\b/c`,
  String.raw`a/..\c`,
  "a/b\0c",
  "a b/c",
  " a/b",
  "a/b ",
  "a/b\n",
  "a/b\tc",
  "a+b/c",
  "a/b+c",
  "a/b~c",
  "é/b",
];

const BAD_LOCATIONS = [
  { name: "a relative directory", overrides: { directory: "state/ledger" } },
  { name: "an empty directory", overrides: { directory: "" } },
  { name: "pull request 0", overrides: { pullRequest: 0 } },
  { name: "a negative pull request", overrides: { pullRequest: -12 } },
  { name: "a fractional pull request", overrides: { pullRequest: 1.5 } },
  {
    name: "a pull request that is no number",
    overrides: { pullRequest: Number.NaN },
  },
  {
    name: "a pull request too large to be exact",
    overrides: { pullRequest: 2 ** 53 },
  },
];

// Reading

test("a pull request with no file has the empty entry, and reading creates nothing", async () => {
  const directory = state();
  expect(await read(directory)).toEqual(emptyReviewLedgerEntry());
  expect(existsSync(directory)).toBe(false);
  mkdirSync(directory);
  expect(await read(directory)).toEqual(emptyReviewLedgerEntry());
  expect(names(directory)).toEqual([]);
});

test("a read returns the stored entry, and an entry of its own each time", async () => {
  const directory = await holding(entry());
  const first = await read(directory);
  expect(first).toEqual(entry());
  first.requiredReviewers.push({ id: 8, kind: "user", login: "added" });
  first.observedRevision = null;
  expect(await read(directory)).toEqual(entry());
});

test("a read takes no lock: it succeeds while a lock file exists and leaves it", async () => {
  const directory = await holding(entry());
  writeFileSync(path.join(directory, LOCK), "");
  expect(await read(directory)).toEqual(entry());
  expect(names(directory)).toEqual([ENTRY, LOCK]);
});

test.each(CORRUPTED)(
  "a read of a stored entry that $name is refused, never read as empty",
  async ({ contents }) => {
    const directory = seeded(contents);
    const before = bytes(directory);
    const error = await ledgerError(read(directory, LATE));
    expect(error.code).toBe("entry-invalid");
    expect(error.message).toStartWith("stored entry: ");
    expect(error.message).not.toContain(MARKER);
    expect(bytes(directory)).toEqual(before);
    expect(names(directory)).toEqual([ENTRY]);
  }
);

test.skipIf(READS_ANYTHING)(
  "a stored entry that cannot be read is refused, not read as empty",
  async () => {
    const directory = await holding(entry());
    chmodSync(path.join(directory, ENTRY), 0o000);
    const reading = await ledgerError(read(directory));
    expect(reading.code).toBe("ledger-unavailable");
    expect(reading.message).toBe("could not read the entry: EACCES");
    const replacing = await ledgerError(
      replace(directory, emptyReviewLedgerEntry(), other())
    );
    expect(replacing.code).toBe("ledger-unavailable");
    expect(replacing.message).toBe("could not read the entry: EACCES");
    expect(names(directory)).toEqual([ENTRY]);
    chmodSync(path.join(directory, ENTRY), 0o600);
    expect(await read(directory)).toEqual(entry());
  }
);

test("a directory where the entry should be is refused, not read as empty", async () => {
  const directory = state();
  mkdirSync(path.join(directory, ENTRY), { recursive: true });
  const reading = await ledgerError(read(directory));
  expect(reading.code).toBe("ledger-unavailable");
  expect(reading.message).toBe("the entry is not a regular file");
  const replacing = await ledgerError(
    replace(directory, emptyReviewLedgerEntry(), entry())
  );
  expect(replacing.code).toBe("ledger-unavailable");
  expect(names(directory)).toEqual([ENTRY]);
  expect(lstatSync(path.join(directory, ENTRY)).isDirectory()).toBe(true);
});

// Opening a named pipe to read waits for a writer unless the open says not
// to. The timeout turns a store that waits into a failed test; it is far
// longer than the few milliseconds this takes, to leave room for a busy host.
test.skipIf(NO_PIPES)(
  "a named pipe where the entry should be is refused at once, and no lock is left",
  async () => {
    const directory = state();
    mkdirSync(directory);
    const pipe = path.join(directory, ENTRY);
    expect(Bun.spawnSync(["mkfifo", pipe]).exitCode).toBe(0);
    pipes.push(pipe);
    const reading = await ledgerError(read(directory));
    expect(reading.code).toBe("ledger-unavailable");
    expect(reading.message).toBe("the entry is not a regular file");
    const replacing = await ledgerError(
      replace(directory, emptyReviewLedgerEntry(), entry())
    );
    expect(replacing.code).toBe("ledger-unavailable");
    expect(replacing.message).toBe("the entry is not a regular file");
    expect(names(directory)).toEqual([ENTRY]);
    expect(lstatSync(pipe).isFIFO()).toBe(true);
  },
  10_000
);

test.each([`{"requiredReviewers": [${MARKER}`, MARKER, "", "{"])(
  "a file holding %p is refused with a message that quotes none of it",
  async (contents) => {
    const directory = seeded(contents);
    const reading = await ledgerError(read(directory));
    expect(reading.message).toBe("stored entry: expected UTF-8 JSON");
    const replacing = await ledgerError(
      replace(directory, emptyReviewLedgerEntry(), entry())
    );
    expect(replacing.message).toBe("stored entry: expected UTF-8 JSON");
    expect(replacing.code).toBe("entry-invalid");
  }
);

test.each([
  {
    name: "a snapshot",
    path: "observedRevision.observedAt",
    stored: entry({
      observedRevision: { baseSha: BASE, headSha: HEAD, observedAt: AFTER_NOW },
      reviewBindings: {},
    }),
  },
  {
    name: "a binding's submission",
    path: "reviewBindings.900.submittedAt",
    stored: entry({
      reviewBindings: { "900": boundAt(SNAPSHOT_AT, AFTER_NOW) },
    }),
  },
  {
    name: "a binding's snapshot",
    path: "reviewBindings.900.observedAt",
    stored: entry({
      reviewBindings: { "900": boundAt(AFTER_NOW, LONG_AFTER_NOW) },
    }),
  },
  {
    name: "a second binding's submission",
    path: "reviewBindings.901.submittedAt",
    stored: entry({
      reviewBindings: {
        "900": boundAt(SNAPSHOT_AT, SUBMITTED_AT),
        "901": boundAt(SNAPSHOT_AT, AFTER_NOW),
      },
    }),
  },
])(
  "a read refuses $name later than now as ahead of the clock, not as invalid",
  async ({ path: field, stored }) => {
    const directory = await holding(stored);
    const before = bytes(directory);
    const error = await ledgerError(read(directory, NOW));
    expect(error.code).toBe("entry-ahead-of-clock");
    expect(error.message).toStartWith(`stored entry: ${field}: `);
    expect(bytes(directory)).toEqual(before);
    expect(names(directory)).toEqual([ENTRY]);
    expect(await read(directory, LONG_AFTER_NOW)).toEqual(stored);
  }
);

test("a read accepts a snapshot and a binding at exactly now", async () => {
  const stored = entry({
    observedRevision: { baseSha: BASE, headSha: HEAD, observedAt: NOW },
    reviewBindings: { "900": boundAt(SNAPSHOT_AT, NOW) },
  });
  const directory = await holding(stored);
  expect(await read(directory, NOW)).toEqual(stored);
  const error = await ledgerError(read(directory, BEFORE_NOW));
  expect(error.code).toBe("entry-ahead-of-clock");
});

test.each([
  "2026-01-01",
  "2026-01-01T01:00:00.000Z",
  "2026-01-01T01:00:00+00:00",
  "2026-02-30T01:00:00Z",
  "",
  MARKER,
])("a read at the time %p is refused before anything is read", async (now) => {
  const directory = seeded(`{${MARKER}`);
  const error = await ledgerError(read(directory, now));
  expect(error.code).toBe("request-invalid");
  expect(error.message).toStartWith("now: expected ");
  expect(error.message).not.toContain(MARKER);
});

test("a read refuses an entry that is a symlink, to something or to nothing", async () => {
  const directory = state();
  const elsewhere = path.join(path.dirname(directory), "elsewhere.json");
  mkdirSync(directory);
  symlinkSync(elsewhere, path.join(directory, ENTRY));
  const dangling = await ledgerError(read(directory));
  expect(dangling.code).toBe("ledger-unavailable");
  expect(dangling.message).toBe("could not read the entry: ELOOP");
  writeFileSync(elsewhere, `${JSON.stringify(entry())}\n`);
  const live = await ledgerError(read(directory));
  expect(live.code).toBe("ledger-unavailable");
  expect(live.message).toBe("could not read the entry: ELOOP");
  expect(names(directory)).toEqual([ENTRY]);
});

test.each(["", path.sep, `${path.sep}.`])(
  "a state directory that is a symlink is refused, also when written with %p after it",
  async (suffix) => {
    const directory = state();
    const real = path.join(path.dirname(directory), "real");
    mkdirSync(real);
    writeFileSync(path.join(real, ENTRY), `${JSON.stringify(entry())}\n`);
    symlinkSync(real, directory);
    const refusal = "the state directory is a symlink or not a directory";
    const reading = await ledgerError(read(`${directory}${suffix}`));
    expect(reading.code).toBe("ledger-unavailable");
    expect(reading.message).toBe(refusal);
    const replacing = await ledgerError(
      replace(`${directory}${suffix}`, entry(), other())
    );
    expect(replacing.code).toBe("ledger-unavailable");
    expect(replacing.message).toBe(refusal);
    expect(names(real)).toEqual([ENTRY]);
    expect(JSON.parse(bytes(real).toString("utf-8"))).toEqual(entry());
  }
);

test("a file where the state directory should be is refused", async () => {
  const directory = state();
  writeFileSync(directory, "obstruction");
  const reading = await ledgerError(read(directory));
  expect(reading.code).toBe("ledger-unavailable");
  const replacing = await ledgerError(
    replace(directory, emptyReviewLedgerEntry(), entry())
  );
  expect(replacing.code).toBe("ledger-unavailable");
  expect(readFileSync(directory, "utf-8")).toBe("obstruction");
});

test("a state directory that cannot be looked for is refused, not read as missing", async () => {
  const obstruction = state();
  writeFileSync(obstruction, "obstruction");
  const directory = path.join(obstruction, "ledger");
  const reading = await ledgerError(read(directory));
  expect(reading.code).toBe("ledger-unavailable");
  const replacing = await ledgerError(
    replace(directory, emptyReviewLedgerEntry(), entry())
  );
  expect(replacing.code).toBe("ledger-unavailable");
  expect(readFileSync(obstruction, "utf-8")).toBe("obstruction");
});

test.skipIf(READS_ANYTHING)(
  "a state directory behind a directory that cannot be searched is refused",
  async () => {
    const directory = await holding(entry());
    const parent = path.dirname(directory);
    chmodSync(parent, 0o000);
    try {
      const reading = await ledgerError(read(directory));
      expect(reading.code).toBe("ledger-unavailable");
      const replacing = await ledgerError(replace(directory, entry(), other()));
      expect(replacing.code).toBe("ledger-unavailable");
    } finally {
      chmodSync(parent, 0o700);
    }
    expect(await read(directory)).toEqual(entry());
  }
);

// Naming and requests

test("a repository is one file whatever case its name is written in", async () => {
  const directory = state();
  const mixed = { repository: "Example/Project" };
  expect(
    await replace(directory, emptyReviewLedgerEntry(), entry(), mixed)
  ).toBe("stored");
  expect(names(directory)).toEqual([ENTRY]);
  expect(await read(directory)).toEqual(entry());
  expect(await read(directory, NOW, { repository: "EXAMPLE/project" })).toEqual(
    entry()
  );
  expect(await replace(directory, entry(), other())).toBe("stored");
  expect(names(directory)).toEqual([ENTRY]);
  expect(await read(directory, NOW, mixed)).toEqual(other());
});

test.each(BAD_REPOSITORIES)(
  "the repository %p is refused before anything is created",
  async (repository) => {
    const directory = state();
    const reading = await ledgerError(read(directory, NOW, { repository }));
    expect(reading.code).toBe("request-invalid");
    expect(reading.message).toStartWith("repository: expected ");
    const replacing = await ledgerError(
      replace(directory, emptyReviewLedgerEntry(), entry(), { repository })
    );
    expect(replacing.code).toBe("request-invalid");
    expect(replacing.message).toStartWith("repository: expected ");
    expect(existsSync(directory)).toBe(false);
  }
);

test.each(BAD_LOCATIONS)(
  "$name is refused before anything is created",
  async ({ overrides }) => {
    const directory = state();
    const reading = await ledgerError(read(directory, NOW, overrides));
    expect(reading.code).toBe("request-invalid");
    const replacing = await ledgerError(
      replace(directory, emptyReviewLedgerEntry(), entry(), overrides)
    );
    expect(replacing.code).toBe("request-invalid");
    expect(existsSync(directory)).toBe(false);
    expect(existsSync("state")).toBe(false);
  }
);

/** An entry that tells one target's file from another's. */
const owned = (index: number): ReviewLedgerEntry =>
  entry({
    requiredReviewers: [{ id: index + 1, kind: "user", login: "reviewer" }],
  });

test("two repositories or two pull requests never share a file", async () => {
  const directory = state();
  const targets = [
    { pullRequest: 12, repository: "a-b/c" },
    { pullRequest: 12, repository: "a/b-c" },
    { pullRequest: 12, repository: "a.b/c" },
    { pullRequest: 12, repository: "a/b.c" },
    { pullRequest: 12, repository: "a_b/c" },
    { pullRequest: 12, repository: "a/b_c" },
    { pullRequest: 12, repository: "a/b" },
    { pullRequest: 1, repository: "a/b" },
    { pullRequest: 2, repository: "a/b1" },
    { pullRequest: 21, repository: "a/b" },
    { pullRequest: 1, repository: "a/b.json" },
    { pullRequest: 1, repository: "a/b.lock" },
  ];
  for (const [index, target] of targets.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- each write is checked against the ones before it
    const outcome = await replace(
      directory,
      emptyReviewLedgerEntry(),
      owned(index),
      target
    );
    expect(outcome).toBe("stored");
  }
  expect(names(directory)).toHaveLength(targets.length);
  expect(names(directory)).toContain("a-b+c+12.json");
  expect(names(directory)).toContain("a+b-c+12.json");
  for (const [index, target] of targets.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- kept in order for a clear failure
    const stored = await read(directory, NOW, target);
    expect(stored).toEqual(owned(index));
  }
});

// Replacing

test("the first entry is stored when nothing is there and nothing was expected", async () => {
  const directory = state();
  expect(await replace(directory, emptyReviewLedgerEntry(), entry())).toBe(
    "stored"
  );
  expect(names(directory)).toEqual([ENTRY]);
  expect(JSON.parse(bytes(directory).toString("utf-8"))).toEqual(entry());
  expect(await read(directory)).toEqual(entry());
});

test("an entry is replaced when the file still holds the one that was read", async () => {
  const directory = await holding(entry());
  const current = await read(directory);
  expect(await replace(directory, current, other())).toBe("stored");
  expect(await read(directory)).toEqual(other());
  expect(names(directory)).toEqual([ENTRY]);
});

test("the expected entry is compared by what it says, not by its order or identity", async () => {
  // Review IDs this large keep the order they were added in.
  const bound = [
    ["5000000000", boundAt(SNAPSHOT_AT, SUBMITTED_AT)],
    ["6000000000", boundAt(SNAPSHOT_AT, NOW)],
  ] as const;
  const stored = entry({ reviewBindings: Object.fromEntries(bound) });
  const directory = await holding(stored);
  const reordered = entry({
    requiredReviewers: stored.requiredReviewers.toReversed(),
    reviewBindings: Object.fromEntries(bound.toReversed()),
  });
  expect(reordered.requiredReviewers).not.toEqual(stored.requiredReviewers);
  expect(Object.keys(reordered.reviewBindings)).not.toEqual(
    Object.keys(stored.reviewBindings)
  );
  expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(stored));
  expect(await replace(directory, reordered, other())).toBe("stored");
  expect(await read(directory)).toEqual(other());
});

const CONFLICTS: { expected: ReviewLedgerEntry; name: string }[] = [
  { expected: emptyReviewLedgerEntry(), name: "nothing" },
  {
    expected: entry({
      requiredReviewers: [{ id: 7, kind: "user", login: "reviewer" }],
    }),
    name: "one reviewer fewer",
  },
  {
    expected: entry({
      requiredReviewers: [
        ...entry().requiredReviewers,
        { id: 8, kind: "user", login: "added" },
      ],
    }),
    name: "one reviewer more",
  },
  {
    expected: entry({
      requiredReviewers: [
        { id: 31, kind: "team", slug: "maintainers" },
        { id: 7, kind: "user", login: "renamed" },
      ],
    }),
    name: "a reviewer under another name",
  },
  {
    expected: entry({
      requiredReviewers: [
        { id: 31, kind: "team", slug: "maintainers" },
        { id: 7, kind: "team", slug: "reviewer" },
      ],
    }),
    name: "a reviewer of another kind",
  },
  { expected: entry({ observedRevision: null }), name: "no snapshot" },
  {
    expected: entry({
      observedRevision: {
        baseSha: OTHER,
        headSha: HEAD,
        observedAt: SNAPSHOT_AT,
      },
    }),
    name: "a snapshot of another base",
  },
  {
    expected: entry({
      observedRevision: {
        baseSha: BASE,
        headSha: HEAD,
        observedAt: "2026-01-01T00:00:01Z",
      },
    }),
    name: "a snapshot taken at another time",
  },
  { expected: entry({ reviewBindings: {} }), name: "no binding" },
  {
    expected: entry({
      reviewBindings: {
        "900": boundAt(SNAPSHOT_AT, SUBMITTED_AT),
        "901": boundAt(SNAPSHOT_AT, SUBMITTED_AT),
      },
    }),
    name: "one binding more",
  },
  {
    expected: entry({
      reviewBindings: { "901": boundAt(SNAPSHOT_AT, SUBMITTED_AT) },
    }),
    name: "the binding under another review",
  },
  {
    expected: entry({
      reviewBindings: {
        "900": { ...boundAt(SNAPSHOT_AT, SUBMITTED_AT), baseSha: OTHER },
      },
    }),
    name: "the binding to another base",
  },
  {
    expected: entry({
      reviewBindings: { "900": boundAt(SNAPSHOT_AT, NOW) },
    }),
    name: "the binding submitted at another time",
  },
];

test.each(CONFLICTS)(
  "a replace that expected $name is a conflict and leaves the file byte for byte",
  async ({ expected }) => {
    const directory = await holding(entry());
    const before = bytes(directory);
    const inode = statSync(path.join(directory, ENTRY)).ino;
    expect(await replace(directory, expected, other())).toBe("conflict");
    expect(bytes(directory)).toEqual(before);
    expect(statSync(path.join(directory, ENTRY)).ino).toBe(inode);
    expect(names(directory)).toEqual([ENTRY]);
  }
);

test("a replace that expected an entry where none is stored is a conflict and writes none", async () => {
  const directory = state();
  expect(await replace(directory, entry(), other())).toBe("conflict");
  expect(names(directory)).toEqual([]);
  expect(await read(directory)).toEqual(emptyReviewLedgerEntry());
});

test("of two collections that read the same entry, the second to store is told so", async () => {
  const directory = await holding(entry());
  const mine = await read(directory);
  const theirs = await read(directory);
  expect(await replace(directory, theirs, other())).toBe("stored");
  const late = entry({ reviewBindings: {} });
  expect(await replace(directory, mine, late)).toBe("conflict");
  expect(await read(directory)).toEqual(other());
  expect(await replace(directory, await read(directory), late)).toBe("stored");
  expect(await read(directory)).toEqual(late);
});

test("replaces started together from one entry store exactly one of them", async () => {
  const directory = await holding(entry());
  const candidates = Array.from({ length: 8 }, (_, index) =>
    entry({
      requiredReviewers: [{ id: index + 1, kind: "user", login: "reviewer" }],
    })
  );
  const settled = await Promise.allSettled(
    candidates.map((candidate) => replace(directory, entry(), candidate))
  );
  const stored = settled.flatMap((result, index) =>
    result.status === "fulfilled" && result.value === "stored" ? [index] : []
  );
  expect(stored).toHaveLength(1);
  for (const result of settled) {
    if (result.status === "rejected") {
      expect(result.reason).toBeInstanceOf(ReviewLedgerError);
      expect(result.reason).toMatchObject({ code: "ledger-busy" });
    } else {
      expect(["stored", "conflict"]).toContain(result.value);
    }
  }
  const winner = candidates[stored[0] ?? -1];
  expect(winner).toBeDefined();
  expect(await read(directory)).toEqual(winner ?? entry());
  expect(names(directory)).toEqual([ENTRY]);
});

/** A replace's outcome, with a held lock counted as a round that stored nothing. */
const attempted = async (
  replacing: Promise<"stored" | "conflict">
): Promise<"stored" | "conflict" | "busy"> => {
  try {
    return await replacing;
  } catch (error) {
    if (error instanceof ReviewLedgerError && error.code === "ledger-busy") {
      return "busy";
    }
    throw error;
  }
};

const WORKERS = 8;
const ROUNDS = 150;

/**
 * One collector's loop: read, add a reviewer nobody else adds, replace. It
 * returns the reviewers it was told were stored.
 */
const collecting = async (
  directory: string,
  worker: number
): Promise<number[]> => {
  const stored: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const id = worker * 1000 + round + 1;
    // oxlint-disable-next-line no-await-in-loop -- each round starts from what the last one left
    const current = await read(directory, LATE);
    const next = {
      ...current,
      requiredReviewers: [
        ...current.requiredReviewers,
        { id, kind: "user" as const, login: "reviewer" },
      ],
    };
    // oxlint-disable-next-line no-await-in-loop -- each round starts from what the last one left
    const outcome = await attempted(replace(directory, current, next));
    if (outcome === "stored") {
      stored.push(id);
    }
  }
  return stored;
};

// The comparison and the write must both happen under the lock. If either
// leaves it, two loops store from one read and the second erases the first's
// reviewer although both were told `"stored"`.
//
// It takes about a tenth of a second, and on an overloaded host it has taken
// more than five. The timeout is long because a run cut short keeps going
// while its directory is removed, and then fails in a later test's name.
test("loops that read and replace at once never lose an entry reported stored", async () => {
  const directory = state();
  const workers = Array.from({ length: WORKERS }, (_, index) => index + 1);
  const reported = await Promise.all(
    workers.map((worker) => collecting(directory, worker))
  );
  const stored = reported.flat().toSorted((left, right) => left - right);
  const final = await read(directory, LATE);
  expect(stored.length).toBeGreaterThan(0);
  expect(final.requiredReviewers).toHaveLength(stored.length);
  expect(
    final.requiredReviewers
      .map((reviewer) => reviewer.id)
      .toSorted((left, right) => left - right)
  ).toEqual(stored);
  expect(names(directory)).toEqual([ENTRY]);
}, 120_000);

test.each(CORRUPTED)(
  "a replace over a stored entry that $name is refused, and the file is not replaced",
  async ({ contents }) => {
    const directory = seeded(contents);
    const before = bytes(directory);
    for (const expected of [emptyReviewLedgerEntry(), entry()]) {
      // oxlint-disable-next-line no-await-in-loop -- neither expectation may get past a corrupted file
      const error = await ledgerError(replace(directory, expected, other()));
      expect(error.code).toBe("entry-invalid");
      expect(error.message).toStartWith("stored entry: ");
      expect(error.message).not.toContain(MARKER);
    }
    expect(bytes(directory)).toEqual(before);
    expect(names(directory)).toEqual([ENTRY]);
  }
);

const UNKNOWN_FIELD = { [MARKER]: true };
const INVALID: { name: string; value: ReviewLedgerEntry }[] = [
  { name: "an unknown field", value: { ...entry(), ...UNKNOWN_FIELD } },
  {
    name: "a reviewer listed twice",
    value: entry({
      requiredReviewers: [
        { id: 7, kind: "user", login: "reviewer" },
        { id: 7, kind: "user", login: MARKER },
      ],
    }),
  },
  {
    name: "a binding observed when it was submitted",
    value: entry({
      reviewBindings: { "900": boundAt(SUBMITTED_AT, SUBMITTED_AT) },
    }),
  },
  {
    name: "a time with fractional seconds",
    value: entry({
      observedRevision: {
        baseSha: BASE,
        headSha: HEAD,
        observedAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  },
];

test.each(INVALID)(
  "a replace with $name in the new entry is refused and the file is left",
  async ({ value }) => {
    const fresh = state();
    const first = await ledgerError(
      replace(fresh, emptyReviewLedgerEntry(), value)
    );
    expect(first.code).toBe("entry-invalid");
    expect(first.message).toStartWith("new entry: ");
    expect(first.message).not.toContain(MARKER);
    expect(names(fresh)).toEqual([]);
    const directory = await holding(entry());
    const before = bytes(directory);
    const kept = await ledgerError(replace(directory, entry(), value));
    expect(kept.code).toBe("entry-invalid");
    expect(bytes(directory)).toEqual(before);
    expect(names(directory)).toEqual([ENTRY]);
  }
);

test.each(INVALID)(
  "a replace with $name in the expected entry is refused before the lock is taken",
  async ({ value }) => {
    const directory = await holding(entry());
    const before = bytes(directory);
    // A lock left in place shows the refusal came first: with it, a valid
    // request would be `ledger-busy`.
    writeFileSync(path.join(directory, LOCK), "");
    const error = await ledgerError(replace(directory, value, other()));
    expect(error.code).toBe("entry-invalid");
    expect(error.message).toStartWith("expected entry: ");
    expect(error.message).not.toContain(MARKER);
    expect(bytes(directory)).toEqual(before);
    expect(names(directory)).toEqual([ENTRY, LOCK]);
  }
);

/** What a caller that ignores the types can hand over: `JSON.parse` is untyped. */
const untyped = (text: string): ReviewLedgerEntry => JSON.parse(text);

test.each(["null", "5", "[]", "{}"])(
  "a replace given %p for an entry is refused and writes nothing",
  async (text) => {
    const directory = state();
    const next = await ledgerError(
      replace(directory, emptyReviewLedgerEntry(), untyped(text))
    );
    expect(next.code).toBe("entry-invalid");
    const expected = await ledgerError(
      replace(directory, untyped(text), entry())
    );
    expect(expected.code).toBe("entry-invalid");
    expect(names(directory)).toEqual([]);
  }
);

test("a new entry is never judged against a clock", async () => {
  const future = entry({
    observedRevision: {
      baseSha: BASE,
      headSha: HEAD,
      observedAt: "2999-01-01T00:00:00Z",
    },
    reviewBindings: {
      "900": boundAt("2999-01-01T00:00:00Z", "2999-01-01T00:00:01Z"),
    },
  });
  const directory = await holding(entry());
  expect(await replace(directory, entry(), future)).toBe("stored");
  expect(await read(directory, LATE)).toEqual(future);
  // And a stored entry ahead of every clock can still be replaced.
  expect(await replace(directory, future, other())).toBe("stored");
  expect(await read(directory)).toEqual(other());
});

test("the replacement is stored as given to the call, whatever happens to the objects afterwards", async () => {
  const directory = state();
  const next = entry();
  const storing = replace(directory, emptyReviewLedgerEntry(), next);
  next.requiredReviewers.push({ id: 8, kind: "user", login: "added" });
  next.observedRevision = null;
  expect(await storing).toBe("stored");
  expect(await read(directory)).toEqual(entry());
});

// The lock

test("a lock left behind blocks every replace until it is removed, and is never taken over", async () => {
  const directory = await holding(entry());
  const before = bytes(directory);
  writeFileSync(path.join(directory, LOCK), "");
  const first = await ledgerError(replace(directory, entry(), other()));
  const again = await ledgerError(replace(directory, entry(), other()));
  expect(first.code).toBe("ledger-busy");
  expect(first.message).toBe(BUSY);
  expect(again.code).toBe("ledger-busy");
  expect(names(directory)).toEqual([ENTRY, LOCK]);
  expect(bytes(directory)).toEqual(before);
  const mixed = await ledgerError(
    replace(directory, entry(), other(), { repository: "Example/Project" })
  );
  expect(mixed.code).toBe("ledger-busy");
  rmSync(path.join(directory, LOCK));
  expect(await replace(directory, entry(), other())).toBe("stored");
  expect(names(directory)).toEqual([ENTRY]);
});

test("a lock on one pull request does not hold up another", async () => {
  const directory = state();
  mkdirSync(directory);
  writeFileSync(path.join(directory, LOCK), "");
  const elsewhere = { pullRequest: 13 };
  expect(
    await replace(directory, emptyReviewLedgerEntry(), other(), elsewhere)
  ).toBe("stored");
  const sibling = { repository: "example/other" };
  expect(
    await replace(directory, emptyReviewLedgerEntry(), other(), sibling)
  ).toBe("stored");
  expect(names(directory)).toEqual([
    "example+other+12.json",
    LOCK,
    "example+project+13.json",
  ]);
});

test("a lock that is a symlink is a lock, and nothing is created through it", async () => {
  const directory = await holding(entry());
  const elsewhere = path.join(path.dirname(directory), "elsewhere.lock");
  const before = bytes(directory);
  symlinkSync(elsewhere, path.join(directory, LOCK));
  const error = await ledgerError(replace(directory, entry(), other()));
  expect(error.code).toBe("ledger-busy");
  expect(existsSync(elsewhere)).toBe(false);
  expect(bytes(directory)).toEqual(before);
  expect(lstatSync(path.join(directory, LOCK)).isSymbolicLink()).toBe(true);
});

/** Trailing space: it makes the file slow to read and changes nothing it says. */
const PADDING = " ".repeat(8 * 1024 * 1024);

/**
 * Runs a replace whose lock cannot be removed, and returns what it threw and
 * where. The lock is swapped for a directory that holds a file as soon as it
 * appears; the stored entry is padded so that the replace is usually still
 * reading it by then. An attempt that was not caught in time is made again.
 */
const replaceWithStuckLock = async (
  contents: string,
  expected: ReviewLedgerEntry
): Promise<{ directory: string; error: unknown }> => {
  // A replace can finish before this loop is given a turn. That attempt shows
  // nothing either way, so it is made again in a fresh directory.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const directory = seeded(contents);
    const lock = path.join(directory, LOCK);
    // An object, so the loop below is seen to depend on something that changes.
    const replaced = { settled: false };
    const replacing = (async () => {
      try {
        return { value: await replace(directory, expected, other()) };
      } catch (error) {
        return { error };
      } finally {
        replaced.settled = true;
      }
    })();
    while (!replaced.settled && !existsSync(lock)) {
      // oxlint-disable-next-line no-await-in-loop -- one look per turn of the event loop
      await nextTurn();
    }
    let swapped = false;
    if (!replaced.settled) {
      try {
        rmSync(lock);
        mkdirSync(lock);
        writeFileSync(path.join(lock, "held"), "");
        swapped = true;
      } catch {
        // The replace removed its lock first: a missed attempt.
      }
    }
    // oxlint-disable-next-line no-await-in-loop -- one attempt at a time
    const outcome = await replacing;
    if (swapped) {
      if ("error" in outcome) {
        return { directory, error: outcome.error };
      }
      throw new Error(
        "the replace returned although its lock could not be removed"
      );
    }
  }
  throw new Error("no replace was caught holding its lock");
};

test.each([
  {
    contents: JSON.stringify(entry()),
    expected: entry(),
    name: "after the entry was stored",
    stored: other(),
  },
  {
    contents: JSON.stringify(entry()),
    expected: other(),
    name: "after a conflict",
    stored: entry(),
  },
  {
    contents: JSON.stringify({ ...entry(), [MARKER]: true }),
    expected: entry(),
    name: "after the stored entry was refused",
    stored: null,
  },
])(
  "a lock that cannot be released $name is reported as that, without a path",
  async ({ contents, expected, stored }) => {
    const { directory, error } = await replaceWithStuckLock(
      `${contents}${PADDING}`,
      expected
    );
    expect(error).toBeInstanceOf(ReviewLedgerError);
    expect(error).toMatchObject({ code: "ledger-unavailable" });
    const shown = error instanceof Error ? error : new Error("not an error");
    expect(shown.message).toMatch(/^could not release the lock: [A-Z_]+$/u);
    expect(shown.cause).toBeUndefined();
    expect(JSON.stringify(Object.entries(shown))).not.toContain(
      path.dirname(directory)
    );
    // The lock is still there, and the entry is whatever the replace got to.
    expect(lstatSync(path.join(directory, LOCK)).isDirectory()).toBe(true);
    if (stored !== null) {
      expect(await read(directory)).toEqual(stored);
    }
    const next = await ledgerError(replace(directory, entry(), other()));
    expect(next.code).toBe("ledger-busy");
  },
  10_000
);

// Writing

test("a replace refuses an entry that is a symlink and leaves its target alone", async () => {
  const directory = state();
  const elsewhere = path.join(path.dirname(directory), "elsewhere.json");
  mkdirSync(directory);
  symlinkSync(elsewhere, path.join(directory, ENTRY));
  const dangling = await ledgerError(
    replace(directory, emptyReviewLedgerEntry(), other())
  );
  expect(dangling.code).toBe("ledger-unavailable");
  expect(existsSync(elsewhere)).toBe(false);
  writeFileSync(elsewhere, `${JSON.stringify(entry())}\n`);
  const before = readFileSync(elsewhere);
  const live = await ledgerError(replace(directory, entry(), other()));
  expect(live.code).toBe("ledger-unavailable");
  expect(readFileSync(elsewhere)).toEqual(before);
  expect(lstatSync(path.join(directory, ENTRY)).isSymbolicLink()).toBe(true);
  expect(names(directory)).toEqual([ENTRY]);
});

test.skipIf(NO_MODES)(
  "the directory is created for its owner only, and the entry too",
  async () => {
    const directory = path.join(state(), "nested", "ledger");
    expect(await replace(directory, emptyReviewLedgerEntry(), entry())).toBe(
      "stored"
    );
    expect(mode(directory)).toBe(0o700);
    expect(mode(path.dirname(directory))).toBe(0o700);
    expect(mode(path.join(directory, ENTRY))).toBe(0o600);
  }
);

test.skipIf(NO_MODES)(
  "a rewritten entry is owner-only whatever the file it replaces allowed",
  async () => {
    const directory = await holding(entry());
    chmodSync(path.join(directory, ENTRY), 0o644);
    expect(await replace(directory, entry(), other())).toBe("stored");
    expect(mode(path.join(directory, ENTRY))).toBe(0o600);
  }
);

test("a replace puts a new file in place and never writes into the old one", async () => {
  const directory = await holding(entry());
  const before = bytes(directory);
  // A second name for the same file: writing in place would change it too.
  linkSync(path.join(directory, ENTRY), path.join(directory, "held"));
  expect(await replace(directory, entry(), other())).toBe("stored");
  expect(bytes(directory, "held")).toEqual(before);
  expect(await read(directory)).toEqual(other());
  expect(names(directory)).toEqual([ENTRY, "held"]);
});

test.skipIf(NO_MODES)(
  "a write the filesystem refuses reports that failure and releases the lock",
  async () => {
    const directory = state();
    // The entry's own name fits in a directory; its temporary file's does not.
    const repository = `example/${"r".repeat(230)}`;
    const error = await ledgerError(
      replace(directory, emptyReviewLedgerEntry(), entry(), { repository })
    );
    expect(error.code).toBe("ledger-unavailable");
    expect(error.message).toBe("could not write the entry: ENAMETOOLONG");
    expect(names(directory)).toEqual([]);
    expect(await read(directory, NOW, { repository })).toEqual(
      emptyReviewLedgerEntry()
    );
  }
);

// Only macOS lets an ordinary user make a file that cannot be renamed over,
// which is the one way to fail the rename after the temporary file is written.
test.skipIf(process.platform !== "darwin")(
  "a rename the filesystem refuses leaves no temporary file and releases the lock",
  async () => {
    const directory = await holding(entry());
    const file = path.join(directory, ENTRY);
    const before = bytes(directory);
    expect(Bun.spawnSync(["chflags", "uchg", file]).exitCode).toBe(0);
    try {
      const error = await ledgerError(replace(directory, entry(), other()));
      expect(error.code).toBe("ledger-unavailable");
      expect(error.message).toBe("could not write the entry: EPERM");
      expect(names(directory)).toEqual([ENTRY]);
      expect(bytes(directory)).toEqual(before);
    } finally {
      Bun.spawnSync(["chflags", "nouchg", file]);
    }
    expect(await replace(directory, entry(), other())).toBe("stored");
  }
);

// With the collector

const SERVED_AT = "2026-01-01T01:00:05Z";
const APPROVED_AT = "2026-01-01T01:10:00Z";
const SERVED_AGAIN = "2026-01-01T02:00:00Z";

/** One stable collection's reads, as raw GitHub responses. */
const reads = (servedAt: string, reviews: unknown[]): PullRequestReads => ({
  pullRequest: () =>
    Promise.resolve({
      body: pullRequestResponse({
        requested_reviewers: [],
        requested_teams: [],
      }),
      servedAt,
    }),
  reviewThreads: () => Promise.resolve(threadPageResponse([])),
  reviews: () => Promise.resolve(reviews),
  timeline: () => Promise.resolve([reviewRequestedEvent()]),
});

const collect = async (
  ledger: ReviewLedgerEntry,
  servedAt: string,
  reviews: unknown[] = []
) => {
  const result = await collectPullRequest(
    {
      holdLabel: "forge:hold",
      ledger,
      maxThreadPages: 5,
      provenance: provenance("collector"),
      pullRequest: 12,
      repository: REPOSITORY,
    },
    reads(servedAt, reviews)
  );
  if (result.status !== "collected") {
    throw new Error(`collection stopped: ${result.status}`);
  }
  return result;
};

test("a read, a real collection and a replace carry the ledger from one collection to the next", async () => {
  const directory = state();
  // The collection is served after the `now` of the read it started from.
  const start = await read(directory, NOW);
  expect(start).toEqual(emptyReviewLedgerEntry());
  const first = await collect(start, SERVED_AT);
  expect(first.ledger.observedRevision).toEqual({
    baseSha: BASE,
    headSha: HEAD,
    observedAt: SERVED_AT,
  });
  expect(await replace(directory, start, first.ledger)).toBe("stored");

  const early = await ledgerError(read(directory, NOW));
  expect(early.code).toBe("entry-ahead-of-clock");
  const stored = await read(directory, SERVED_AT);
  expect(stored).toEqual(first.ledger);

  const approval = reviewResponse({ submitted_at: APPROVED_AT });
  const second = await collect(stored, SERVED_AGAIN, [approval]);
  expect(second.evidence.humanReviews).toEqual([
    {
      reviewer: "reviewer (user 7)",
      state: "approved",
      subject: {
        baseSha: BASE,
        headSha: HEAD,
        id: 12,
        kind: "pull_request",
        repository: REPOSITORY,
      },
    },
  ]);
  expect(await replace(directory, stored, second.ledger)).toBe("stored");
  expect(await read(directory, SERVED_AGAIN)).toEqual(second.ledger);
  expect(Object.keys(second.ledger.reviewBindings)).toEqual(["900"]);
  expect(names(directory)).toEqual([ENTRY]);
});

test("a collection that started from an entry since replaced cannot store its own", async () => {
  const directory = state();
  const start = await read(directory, NOW);
  const winner = await collect(start, SERVED_AT);
  const loser = await collect(start, SERVED_AGAIN);
  expect(await replace(directory, start, winner.ledger)).toBe("stored");
  expect(await replace(directory, start, loser.ledger)).toBe("conflict");
  expect(await read(directory, SERVED_AGAIN)).toEqual(winner.ledger);
});
