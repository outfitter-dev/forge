import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  collectPullRequest,
  emptyReviewLedgerEntry,
  parseReviewLedgerEntry,
  readReviewLedger,
  replaceReviewLedger,
  ReviewLedgerError,
} from "../src/index.ts";
import type { ReviewFindingLedger, ReviewLedgerEntry } from "../src/index.ts";
import {
  finding,
  followUp,
  HOSTED,
  nativeResolution,
} from "./agent-review-fixtures.ts";
import { BASE, HEAD, provenance, REPOSITORY } from "./evidence-fixtures.ts";
import { pullRequestResponse, threadPageResponse } from "./github-fixtures.ts";

const UNKNOWN = { findings: [], recorded: false };
const MARKER = "private-finding-content";
const legacy = (): ReviewLedgerEntry => ({
  observedRevision: null,
  requiredReviewers: [],
  reviewBindings: {},
});
const accepted = (recorded = true): ReviewFindingLedger => ({
  findings: [finding()],
  recorded,
});
const entry = (reviewFindings = accepted()) => ({
  ...emptyReviewLedgerEntry(),
  reviewFindings,
});
const roots: string[] = [];
const location = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "forge-findings-"));
  roots.push(directory);
  return { directory, pullRequest: 12, repository: REPOSITORY };
};
const file = (directory: string) =>
  path.join(directory, "example+project+12.json");
const now = "2999-12-31T23:59:59Z";
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const collect = async (
  ledger: ReviewLedgerEntry,
  headSha = HEAD,
  baseSha = BASE
) => {
  const result = await collectPullRequest(
    {
      holdLabel: "forge:hold",
      ledger,
      maxThreadPages: 2,
      provenance: provenance("collector"),
      pullRequest: 12,
      repository: REPOSITORY,
    },
    {
      pullRequest: () =>
        Promise.resolve({
          body: pullRequestResponse({
            base: {
              ref: "main",
              repo: { full_name: REPOSITORY, id: 100 },
              sha: baseSha,
            },
            head: { ref: "feature", repo: { id: 100 }, sha: headSha },
          }),
          servedAt: "2026-01-01T01:00:00Z",
        }),
      reviewThreads: () => Promise.resolve(threadPageResponse([])),
      reviews: () => Promise.resolve([]),
      timeline: () => Promise.resolve([]),
    }
  );
  if (result.status !== "collected") {
    throw new Error("fixture collection failed");
  }
  return result;
};

test("legacy finding history stays unknown through read, collection and canonical replacement", async () => {
  const place = location();
  writeFileSync(file(place.directory), JSON.stringify(legacy()));
  const before = await readReviewLedger({ ...place, now });
  expect(before.reviewFindings).toEqual(UNKNOWN);
  const result = await collect(before);
  expect(result.ledger.reviewFindings).toEqual(UNKNOWN);
  expect(await replaceReviewLedger(place, before, result.ledger)).toBe(
    "stored"
  );
  const stored = JSON.parse(readFileSync(file(place.directory), "utf-8"));
  expect(stored.reviewFindings).toEqual(UNKNOWN);
  expect(Object.keys(stored).toSorted()).toEqual([
    "observedRevision",
    "requiredReviewers",
    "reviewBindings",
    "reviewFindings",
  ]);
  expect(parseReviewLedgerEntry(legacy()).reviewFindings).toEqual(UNKNOWN);
});

test("findings survive changed revisions and collections with no agent observations", async () => {
  const before = entry();
  const result = await collect(before, "c".repeat(40), "d".repeat(40));
  expect(result.ledger.reviewFindings).toEqual(before.reviewFindings);
  expect(result.ledger.reviewFindings).not.toBe(before.reviewFindings);
  expect(result.ledger.reviewFindings.findings[0]).not.toBe(
    before.reviewFindings.findings[0]
  );
  expect(result.ledger.observedRevision).toMatchObject({
    baseSha: "d".repeat(40),
    headSha: "c".repeat(40),
  });
});

test.each([true, false])(
  "explicit finding completeness %s is preserved",
  (recorded) => {
    expect(
      parseReviewLedgerEntry(entry(accepted(recorded))).reviewFindings.recorded
    ).toBe(recorded);
  }
);

test("native and follow-up resolutions use evaluator shapes and are deeply copied", () => {
  for (const resolution of [nativeResolution(), followUp()]) {
    const source = entry({
      findings: [finding({ resolution })],
      recorded: true,
    });
    const parsed = parseReviewLedgerEntry(source);
    expect(parsed.reviewFindings).toEqual(source.reviewFindings);
    expect(parsed.reviewFindings.findings[0]?.resolution).not.toBe(resolution);
  }
});

test.each(
  [
    null,
    { recorded: true },
    { findings: [], recorded: "true" },
    { findings: [finding(), finding()], recorded: true },
    { findings: [{ ...finding(), id: "" }], recorded: true },
    { findings: [{ ...finding(), kind: "unknown" }], recorded: true },
    { findings: [{ ...finding(), resolution: {} }], recorded: true },
    {
      findings: [
        {
          ...finding(),
          resolution: { ...nativeResolution(), provenance: null },
        },
      ],
      recorded: true,
    },
    {
      findings: [
        { ...finding(), resolution: { ...followUp(), subject: null } },
      ],
      recorded: true,
    },
    {
      findings: [
        { ...finding(), resolution: { ...followUp(), disposition: "unknown" } },
      ],
      recorded: true,
    },
    {
      findings: [
        {
          ...finding(),
          resolution: { ...nativeResolution(), [MARKER]: MARKER },
        },
      ],
      recorded: true,
    },
  ].map((value) => ({ value }))
)(
  "corrupted finding history is rejected without leaking source content",
  ({ value }) => {
    try {
      parseReviewLedgerEntry({ ...legacy(), reviewFindings: value });
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewLedgerError);
      expect((error as ReviewLedgerError).code).toBe("entry-invalid");
      expect(String(error)).not.toContain(MARKER);
      return;
    }
    throw new Error("invalid findings accepted");
  }
);

test("same native finding ID under distinct reviewers remains distinct", () => {
  expect(
    parseReviewLedgerEntry(
      entry({
        findings: [finding(), finding({ reviewer: HOSTED })],
        recorded: true,
      })
    ).reviewFindings.findings
  ).toHaveLength(2);
});

test("hidden and symbol fields in finding resolutions cannot disappear during serialization", () => {
  for (const key of [MARKER, Symbol(MARKER)]) {
    const resolution = nativeResolution();
    Object.defineProperty(resolution, key, { value: MARKER });
    expect(() =>
      parseReviewLedgerEntry(
        entry({ findings: [finding({ resolution })], recorded: true })
      )
    ).toThrow(ReviewLedgerError);
  }
});

test("concurrent findings-only updates conflict without erasing the accepted finding", async () => {
  const place = location();
  const before = emptyReviewLedgerEntry();
  expect(await replaceReviewLedger(place, before, entry())).toBe("stored");
  expect(
    await replaceReviewLedger(place, before, {
      ...before,
      observedRevision: {
        baseSha: BASE,
        headSha: HEAD,
        observedAt: "2026-01-01T01:00:00Z",
      },
    })
  ).toBe("conflict");
  const persisted = await readReviewLedger({ ...place, now });
  expect(persisted.reviewFindings).toEqual(accepted());
});

test("legacy callers omitting findings preserve the current expected history", async () => {
  const place = location();
  expect(await replaceReviewLedger(place, legacy(), entry())).toBe("stored");
  const before = await readReviewLedger({ ...place, now });
  expect(await replaceReviewLedger(place, before, legacy())).toBe("stored");
  const persisted = await readReviewLedger({ ...place, now });
  expect(persisted.reviewFindings).toEqual(accepted());
});

test("explicit finding removal or changed origin is refused while native resolve and reopen persist", async () => {
  const place = location();
  const before = entry();
  expect(await replaceReviewLedger(place, legacy(), before)).toBe("stored");
  for (const next of [
    entry({ findings: [], recorded: false }),
    entry({ findings: [finding({ attemptId: "changed" })], recorded: true }),
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Each rejected update must release its lock before the next attempt.
    await expect(
      replaceReviewLedger(place, before, next)
    ).rejects.toMatchObject({ code: "entry-invalid" });
  }
  const resolved = entry({
    findings: [finding({ resolution: nativeResolution() })],
    recorded: true,
  });
  expect(await replaceReviewLedger(place, before, resolved)).toBe("stored");
  expect(await replaceReviewLedger(place, resolved, before)).toBe("stored");
  const persisted = await readReviewLedger({ ...place, now });
  expect(persisted.reviewFindings.findings[0]?.resolution).toBeNull();
});

test("corrupted persisted findings stop reads and replacements without rewriting the file", async () => {
  const place = location();
  const bytes = JSON.stringify({
    ...legacy(),
    reviewFindings: { findings: [finding(), finding()], recorded: true },
  });
  writeFileSync(file(place.directory), bytes);
  await expect(readReviewLedger({ ...place, now })).rejects.toMatchObject({
    code: "entry-invalid",
  });
  await expect(
    replaceReviewLedger(place, legacy(), entry())
  ).rejects.toMatchObject({ code: "entry-invalid" });
  expect(readFileSync(file(place.directory), "utf-8")).toBe(bytes);
});

test("present undefined finding history and hidden array fields cannot become legacy absence", () => {
  expect(() =>
    parseReviewLedgerEntry({ ...legacy(), reviewFindings: undefined })
  ).toThrow(ReviewLedgerError);
  const findings = [finding()];
  Object.defineProperty(findings, Symbol(MARKER), { value: MARKER });
  expect(() =>
    parseReviewLedgerEntry(entry({ findings, recorded: true }))
  ).toThrow(ReviewLedgerError);
});
