import { expect, test } from "bun:test";

import { humanReviewEvidence } from "../src/human-review-evidence.ts";
import type { HumanReviewInput } from "../src/human-review-evidence.ts";
import {
  emptyReviewLedgerEntry,
  parseReviewLedgerEntry,
  ReviewLedgerError,
} from "../src/index.ts";
import {
  parsePullRequest,
  parseReviewRequests,
  parseReviews,
} from "../src/parse-github-pull-request.ts";
import { REPOSITORY } from "./evidence-fixtures.ts";
import {
  actorResponse,
  BASE,
  HEAD,
  pullRequestResponse,
  reviewRequestedEvent,
  reviewResponse,
  teamResponse,
} from "./github-fixtures.ts";

const SNAPSHOT_AT = "2026-01-01T00:00:00Z";
const SUBMITTED_AT = "2026-01-01T00:10:00Z";
/** Stands for content that must never reach an error message. It is one token. */
const MARKER = "privateLedgerMarker";

const reviewer = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  kind: "user",
  login: "reviewer",
  ...overrides,
});

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  baseSha: BASE,
  headSha: HEAD,
  observedAt: SNAPSHOT_AT,
  ...overrides,
});

const binding = (overrides: Record<string, unknown> = {}) => ({
  ...snapshot(),
  submittedAt: SUBMITTED_AT,
  ...overrides,
});

const entry = (overrides: Record<string, unknown> = {}) => ({
  observedRevision: snapshot(),
  requiredReviewers: [reviewer()],
  reviewBindings: { "900": binding() },
  ...overrides,
});

const without = (value: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

const withReviewer = (item: unknown) => entry({ requiredReviewers: [item] });
const withSnapshot = (item: unknown) => entry({ observedRevision: item });
const withBinding = (item: unknown, key = "900") =>
  entry({ reviewBindings: { [key]: item } });

const rejection = (value: unknown): ReviewLedgerError => {
  try {
    parseReviewLedgerEntry(value);
  } catch (error) {
    if (error instanceof ReviewLedgerError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the entry to be rejected");
};

/** An entry with a field that is there but would not be written to a file. */
const hidden = (field: string): unknown => {
  const value = entry();
  Object.defineProperty(value, field, { enumerable: false, value: null });
  return value;
};

/** Holds exactly an entry's fields as its own, and is still no plain object. */
class EntryInstance {
  observedRevision = null;
  requiredReviewers: unknown[] = [];
  reviewBindings = {};
}

/** A list whose first place was never filled. */
const holed = (): unknown[] => {
  const list: unknown[] = [];
  list[1] = reviewer();
  return list;
};

test("a valid entry comes back sorted by kind and then ID", () => {
  const result = parseReviewLedgerEntry(
    entry({
      requiredReviewers: [
        reviewer(),
        { id: 31, kind: "team", slug: "maintainers" },
        reviewer({ id: 5, login: "earlier" }),
        { id: 4, kind: "team", slug: "security" },
      ],
    })
  );
  expect(result).toEqual({
    observedRevision: {
      baseSha: BASE,
      headSha: HEAD,
      observedAt: SNAPSHOT_AT,
    },
    requiredReviewers: [
      { id: 4, kind: "team", slug: "security" },
      { id: 31, kind: "team", slug: "maintainers" },
      { id: 5, kind: "user", login: "earlier" },
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
  });
});

test("the result shares no object with the input", () => {
  const input = entry();
  const before = structuredClone(input);
  const result = parseReviewLedgerEntry(input);
  expect(result).not.toBe(input);
  expect(result.requiredReviewers).not.toBe(input.requiredReviewers);
  expect(result.requiredReviewers[0]).not.toBe(input.requiredReviewers[0]);
  expect(result.observedRevision).not.toBe(input.observedRevision);
  expect(result.reviewBindings).not.toBe(input.reviewBindings);
  expect(result.reviewBindings["900"]).not.toBe(input.reviewBindings["900"]);
  result.requiredReviewers.push({ id: 8, kind: "user", login: "added" });
  result.reviewBindings["901"] = {
    baseSha: BASE,
    headSha: HEAD,
    observedAt: SNAPSHOT_AT,
    submittedAt: SUBMITTED_AT,
  };
  if (result.observedRevision !== null) {
    result.observedRevision.headSha = BASE;
  }
  expect(input).toEqual(before);
});

test("an entry with nothing recorded is valid, and so is the empty entry", () => {
  const empty = {
    observedRevision: null,
    requiredReviewers: [],
    reviewBindings: {},
  };
  expect(parseReviewLedgerEntry(empty)).toEqual(empty);
  expect(emptyReviewLedgerEntry()).toEqual(empty);
  expect(parseReviewLedgerEntry(emptyReviewLedgerEntry())).toEqual(empty);
  expect(emptyReviewLedgerEntry()).not.toBe(emptyReviewLedgerEntry());
  expect(emptyReviewLedgerEntry().reviewBindings).not.toBe(
    emptyReviewLedgerEntry().reviewBindings
  );
});

test("a person and a team with the same number are two reviewers", () => {
  const result = parseReviewLedgerEntry(
    entry({
      requiredReviewers: [reviewer(), { id: 7, kind: "team", slug: "seven" }],
    })
  );
  expect(result.requiredReviewers).toHaveLength(2);
});

test("an entry without a prototype is read like any other plain object", () => {
  const bare: unknown = Object.assign(Object.create(null), entry());
  expect(parseReviewLedgerEntry(bare)).toEqual(parseReviewLedgerEntry(entry()));
});

test("an entry's times are not compared with any clock", () => {
  const future = entry({
    observedRevision: snapshot({ observedAt: "2999-01-01T00:00:00Z" }),
    reviewBindings: {
      "900": binding({
        observedAt: "2999-01-01T00:00:00Z",
        submittedAt: "2999-01-01T00:00:01Z",
      }),
    },
  });
  const result = parseReviewLedgerEntry(future);
  expect(result.observedRevision?.observedAt).toBe("2999-01-01T00:00:00Z");
  expect(result.reviewBindings["900"]?.submittedAt).toBe(
    "2999-01-01T00:00:01Z"
  );
});

test.each([
  { name: "null", path: "entry", value: null },
  { name: "an array", path: "entry", value: [] },
  { name: "a string", path: "entry", value: MARKER },
  { name: "a number", path: "entry", value: 42 },
  { name: "a map", path: "entry", value: new Map(Object.entries(entry())) },
  {
    name: "a class instance with an entry's fields",
    path: "entry",
    value: new EntryInstance(),
  },
  {
    name: "a reviewer list with a hole",
    path: "requiredReviewers[0]",
    value: entry({ requiredReviewers: holed() }),
  },
  {
    name: "bindings that are an empty list",
    path: "reviewBindings",
    value: entry({ reviewBindings: [] }),
  },
  {
    name: "a snapshot that is an empty list",
    path: "observedRevision",
    value: entry({ observedRevision: [] }),
  },
  {
    name: "an object that only inherits its fields",
    path: "entry",
    value: Object.create(entry()),
  },
  {
    name: "an entry missing a field",
    path: "entry",
    value: without(entry(), "reviewBindings"),
  },
  {
    name: "an entry with an unknown field",
    path: "entry",
    value: entry({ [MARKER]: true }),
  },
  {
    name: "an entry with a symbol field",
    path: "entry",
    value: { ...entry(), [Symbol(MARKER)]: true },
  },
  {
    name: "an entry whose snapshot is hidden",
    path: "entry",
    value: hidden("observedRevision"),
  },
  {
    name: "an entry with a hidden unknown field",
    path: "entry",
    value: hidden(MARKER),
  },
  {
    name: "reviewers that are not a list",
    path: "requiredReviewers",
    value: entry({ requiredReviewers: { "0": reviewer() } }),
  },
  {
    name: "a reviewer that is not an object",
    path: "requiredReviewers[0]",
    value: withReviewer(MARKER),
  },
  {
    name: "a reviewer of an unknown kind",
    path: "requiredReviewers[0].kind",
    value: withReviewer(reviewer({ kind: MARKER })),
  },
  {
    name: "a reviewer with no kind",
    path: "requiredReviewers[0].kind",
    value: withReviewer(without(reviewer(), "kind")),
  },
  {
    name: "a reviewer with ID 0",
    path: "requiredReviewers[0].id",
    value: withReviewer(reviewer({ id: 0 })),
  },
  {
    name: "a reviewer with a negative ID",
    path: "requiredReviewers[0].id",
    value: withReviewer(reviewer({ id: -7 })),
  },
  {
    name: "a reviewer with a fractional ID",
    path: "requiredReviewers[0].id",
    value: withReviewer(reviewer({ id: 7.5 })),
  },
  {
    name: "a reviewer with an ID too large to be exact",
    path: "requiredReviewers[0].id",
    value: withReviewer(reviewer({ id: 2 ** 53 })),
  },
  {
    name: "a reviewer with a string ID",
    path: "requiredReviewers[0].id",
    value: withReviewer(reviewer({ id: MARKER })),
  },
  {
    name: "a reviewer with a numeric string ID",
    path: "requiredReviewers[0].id",
    value: withReviewer(reviewer({ id: "7" })),
  },
  {
    name: "a person with an empty login",
    path: "requiredReviewers[0].login",
    value: withReviewer(reviewer({ login: "" })),
  },
  {
    name: "a person whose login is not a string",
    path: "requiredReviewers[0].login",
    value: withReviewer(reviewer({ login: 7 })),
  },
  {
    name: "a team with an empty slug",
    path: "requiredReviewers[0].slug",
    value: withReviewer({ id: 31, kind: "team", slug: "" }),
  },
  {
    name: "a person named like a team",
    path: "requiredReviewers[0]",
    value: withReviewer({ id: 7, kind: "user", slug: MARKER }),
  },
  {
    name: "a team named like a person",
    path: "requiredReviewers[0]",
    value: withReviewer({ id: 31, kind: "team", login: MARKER }),
  },
  {
    name: "a reviewer with an unknown field",
    path: "requiredReviewers[0]",
    value: withReviewer(reviewer({ [MARKER]: true })),
  },
  {
    name: "a reviewer listed twice",
    path: "requiredReviewers[1]",
    value: entry({
      requiredReviewers: [reviewer(), reviewer({ login: MARKER })],
    }),
  },
  {
    name: "a missing snapshot",
    path: "entry",
    value: without(entry(), "observedRevision"),
  },
  {
    name: "a snapshot that is not an object",
    path: "observedRevision",
    value: withSnapshot(MARKER),
  },
  {
    name: "a snapshot that is a list",
    path: "observedRevision",
    value: withSnapshot([HEAD, BASE, SNAPSHOT_AT]),
  },
  {
    name: "a snapshot with an unknown field",
    path: "observedRevision",
    value: withSnapshot(snapshot({ [MARKER]: true })),
  },
  {
    name: "a snapshot with a binding's field",
    path: "observedRevision",
    value: withSnapshot(binding()),
  },
  {
    name: "a snapshot missing its time",
    path: "observedRevision",
    value: withSnapshot(without(snapshot(), "observedAt")),
  },
  {
    name: "a short head commit",
    path: "observedRevision.headSha",
    value: withSnapshot(snapshot({ headSha: `${MARKER}abc123` })),
  },
  {
    name: "an uppercase head commit",
    path: "observedRevision.headSha",
    value: withSnapshot(snapshot({ headSha: "A".repeat(40) })),
  },
  {
    name: "a head commit of 41 characters",
    path: "observedRevision.headSha",
    value: withSnapshot(snapshot({ headSha: "a".repeat(41) })),
  },
  {
    name: "a head commit followed by a line break",
    path: "observedRevision.headSha",
    value: withSnapshot(snapshot({ headSha: `${HEAD}\n` })),
  },
  {
    name: "a base commit that is not hexadecimal",
    path: "observedRevision.baseSha",
    value: withSnapshot(snapshot({ baseSha: "g".repeat(40) })),
  },
  {
    name: "a base commit that is not a string",
    path: "observedRevision.baseSha",
    value: withSnapshot(snapshot({ baseSha: 40 })),
  },
  {
    name: "a time with fractional seconds",
    path: "observedRevision.observedAt",
    value: withSnapshot(snapshot({ observedAt: "2026-01-01T00:00:00.000Z" })),
  },
  {
    name: "a time with an offset",
    path: "observedRevision.observedAt",
    value: withSnapshot(snapshot({ observedAt: "2026-01-01T00:00:00+00:00" })),
  },
  {
    name: "a date that does not exist",
    path: "observedRevision.observedAt",
    value: withSnapshot(snapshot({ observedAt: "2026-02-30T00:00:00Z" })),
  },
  {
    name: "a time that is not a time",
    path: "observedRevision.observedAt",
    value: withSnapshot(snapshot({ observedAt: MARKER })),
  },
  {
    name: "a time given as a number",
    path: "observedRevision.observedAt",
    value: withSnapshot(snapshot({ observedAt: 1_767_225_600_000 })),
  },
  {
    name: "bindings that are a list",
    path: "reviewBindings",
    value: entry({ reviewBindings: [binding()] }),
  },
  {
    name: "bindings that are null",
    path: "reviewBindings",
    value: entry({ reviewBindings: null }),
  },
  {
    name: "a binding key with leading zeros",
    path: "reviewBindings",
    value: withBinding(binding(), "007"),
  },
  {
    name: "a negative binding key",
    path: "reviewBindings",
    value: withBinding(binding(), "-1"),
  },
  {
    name: "a fractional binding key",
    path: "reviewBindings",
    value: withBinding(binding(), "1.5"),
  },
  {
    name: "a binding key that is not a number",
    path: "reviewBindings",
    value: withBinding(binding(), "abc"),
  },
  {
    name: "a binding key that carries content",
    path: "reviewBindings",
    value: withBinding(binding(), MARKER),
  },
  {
    name: "a binding key of zero",
    path: "reviewBindings",
    value: withBinding(binding(), "0"),
  },
  {
    name: "an empty binding key",
    path: "reviewBindings",
    value: withBinding(binding(), ""),
  },
  {
    name: "a binding key in exponent form",
    path: "reviewBindings",
    value: withBinding(binding(), "1e3"),
  },
  {
    name: "a binding key with a space",
    path: "reviewBindings",
    value: withBinding(binding(), " 900"),
  },
  {
    name: "a binding key too large to be an exact review ID",
    path: "reviewBindings",
    value: withBinding(binding(), "9007199254740993"),
  },
  {
    name: "a binding key that would replace the prototype",
    path: "reviewBindings",
    value: entry({
      reviewBindings: JSON.parse('{"__proto__":{"headSha":"x"}}'),
    }),
  },
  {
    name: "a binding that is not an object",
    path: "reviewBindings.900",
    value: withBinding(MARKER),
  },
  {
    name: "a binding with an unknown field",
    path: "reviewBindings.900",
    value: withBinding(binding({ [MARKER]: true })),
  },
  {
    name: "a binding with no submission time",
    path: "reviewBindings.900",
    value: withBinding(snapshot()),
  },
  {
    name: "a binding with a short head commit",
    path: "reviewBindings.900.headSha",
    value: withBinding(binding({ headSha: MARKER })),
  },
  {
    name: "a binding with an uppercase base commit",
    path: "reviewBindings.900.baseSha",
    value: withBinding(binding({ baseSha: "B".repeat(40) })),
  },
  {
    name: "a binding submitted at a time with fractional seconds",
    path: "reviewBindings.900.submittedAt",
    value: withBinding(binding({ submittedAt: "2026-01-01T00:10:00.5Z" })),
  },
  {
    name: "a binding observed at something that is not a time",
    path: "reviewBindings.900.observedAt",
    value: withBinding(binding({ observedAt: MARKER })),
  },
  {
    name: "a binding observed when it was submitted",
    path: "reviewBindings.900.observedAt",
    value: withBinding(binding({ observedAt: SUBMITTED_AT })),
  },
  {
    name: "a binding observed after it was submitted",
    path: "reviewBindings.900.observedAt",
    value: withBinding(
      binding({ observedAt: SUBMITTED_AT, submittedAt: SNAPSHOT_AT })
    ),
  },
])("$name is rejected at $path without its content", ({ path, value }) => {
  const error = rejection(value);
  expect(error.code).toBe("entry-invalid");
  expect(error.message).toStartWith(`${path}: expected `);
  expect(error.message).not.toContain(MARKER);
  expect(error.message).not.toContain("AAAA");
  expect(error.message).not.toContain("BBBB");
  expect(error.message).not.toContain("007");
  expect(error.name).toBe("ReviewLedgerError");
});

const FIRST_READ = "2026-01-01T00:05:00Z";
const SECOND_READ = "2026-01-01T00:30:00Z";

const collection = (input: Partial<HumanReviewInput>) =>
  humanReviewEvidence({
    baseChanges: [],
    ledger: emptyReviewLedgerEntry(),
    pullRequest: parsePullRequest(
      pullRequestResponse({ requested_teams: [teamResponse()] })
    ),
    pullRequestReadAt: FIRST_READ,
    repository: REPOSITORY,
    requests: parseReviewRequests([
      reviewRequestedEvent(),
      reviewRequestedEvent({
        requested_reviewer: undefined,
        requested_team: teamResponse("security", 32),
      }),
    ]),
    reviews: [],
    ...input,
  });

/** Two real collections: the first takes the snapshot, the second binds. */
const collected = () => {
  const first = collection({});
  const second = collection({
    ledger: first.ledger,
    pullRequestReadAt: SECOND_READ,
    reviews: parseReviews([reviewResponse({ submitted_at: SUBMITTED_AT })]),
  });
  return { first: first.ledger, second: second.ledger };
};

test("an entry the collector really produces passes unchanged", () => {
  const { first, second } = collected();
  expect(first.observedRevision).toEqual({
    baseSha: BASE,
    headSha: HEAD,
    observedAt: FIRST_READ,
  });
  expect(second.requiredReviewers).toHaveLength(3);
  expect(Object.keys(second.reviewBindings)).toEqual(["900"]);
  expect(parseReviewLedgerEntry(first)).toEqual(first);
  expect(parseReviewLedgerEntry(second)).toEqual(second);
  // As the file holds it: written as JSON text and read back.
  const text = JSON.stringify(second);
  const stored: unknown = JSON.parse(text);
  expect(parseReviewLedgerEntry(stored)).toEqual(second);
});

const LARGEST = Number.MAX_SAFE_INTEGER;
const EDGE_HEAD = "0123456789abcdef0123456789abcdef01234567";
const EDGE_BASE = "f".repeat(40);
const LEAP_DAY = "2028-02-29T00:00:00Z";
const LEAP_NOON = "2028-02-29T12:00:00Z";
const LEAP_END = "2028-02-29T23:59:59Z";

// The validator repeats rules the GitHub parsers own. If a parser accepted a
// value the validator refused, no collection holding it could ever be stored.
test("what the GitHub parsers accept at their edges, the validator accepts", () => {
  const collect = (
    pullRequestReadAt: string,
    ledger = emptyReviewLedgerEntry(),
    reviews: unknown[] = []
  ) =>
    humanReviewEvidence({
      baseChanges: [],
      ledger,
      pullRequest: parsePullRequest(
        pullRequestResponse({
          base: {
            ref: "main",
            repo: { full_name: REPOSITORY, id: 100 },
            sha: EDGE_BASE,
          },
          head: { ref: "feature", repo: { id: 100 }, sha: EDGE_HEAD },
          requested_reviewers: [actorResponse("r", LARGEST)],
          requested_teams: [teamResponse("t", LARGEST)],
        })
      ),
      pullRequestReadAt,
      repository: REPOSITORY,
      requests: [],
      reviews: parseReviews(reviews),
    }).ledger;
  const first = collect(LEAP_DAY);
  const second = collect(LEAP_END, first, [
    reviewResponse({
      commit_id: EDGE_HEAD,
      id: LARGEST,
      submitted_at: LEAP_NOON,
      user: actorResponse("r", LARGEST),
    }),
  ]);
  expect(second).toEqual({
    observedRevision: {
      baseSha: EDGE_BASE,
      headSha: EDGE_HEAD,
      observedAt: LEAP_DAY,
    },
    requiredReviewers: [
      { id: LARGEST, kind: "team", slug: "t" },
      { id: LARGEST, kind: "user", login: "r" },
    ],
    reviewBindings: {
      "9007199254740991": {
        baseSha: EDGE_BASE,
        headSha: EDGE_HEAD,
        observedAt: LEAP_DAY,
        submittedAt: LEAP_NOON,
      },
    },
  });
  expect(parseReviewLedgerEntry(first)).toEqual(first);
  expect(parseReviewLedgerEntry(second)).toEqual(second);
});
