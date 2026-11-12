import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { GateDocument } from "../src/gate-document.ts";
import {
  evaluateEvidence,
  GATE_NAMES,
  VERIFICATION_GATES,
} from "../src/index.ts";
import type { GateName } from "../src/index.ts";
import {
  finding,
  HOSTED,
  nativeResolution,
  policyV2,
} from "./agent-review-fixtures.ts";
import { BASE, HEAD, REPOSITORY } from "./evidence-fixtures.ts";
import {
  APPROVED_AT,
  cleanReview,
  gatePolicy,
  HOLD,
  pass,
  PULL_REQUEST,
  pullRequest,
  receipt,
  SERVED,
  source,
  SERVED_EARLY,
} from "./gate-fixtures.ts";
import type { GateScript } from "./gate-fixtures.ts";
import {
  actorResponse,
  reviewRequestedEvent,
  reviewResponse,
  threadPageResponse,
} from "./github-fixtures.ts";

// Every test starts Bun as a subprocess, some of them several times, and CI
// and shared machines can be slow to start one.
setDefaultTimeout(30_000);

const root = path.resolve(import.meta.dir, "..");
const cli = path.join(root, "src/forge-cli.ts");
const preload = path.join(root, "tests/gate-fetch-preload.ts");
const ORIGIN = "https://api.github.com";
/** Shaped like a credential, so a leak into output is easy to see. */
const TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
const RUN_ID = "build-4521";
/** Stands for file content and exception text that must never be repeated. */
const MARKER = "private-input-marker";
const LEDGER_NAME = `example+project+${PULL_REQUEST}`;

interface Workspace {
  /** The subprocess's working directory, standing for a checkout. */
  work: string;
  /** Not created: the command makes it when it first stores a ledger. */
  state: string;
  inputs: string;
  harness: string;
  ledgerDirectory: string;
  ledgerFile: string;
  runs: number;
}

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const workspace = (): Workspace => {
  // A space in the path, as a person's directory may have.
  const top = mkdtempSync(path.join(tmpdir(), "forge gate "));
  temporary.push(top);
  const created = {
    harness: path.join(top, "harness"),
    inputs: path.join(top, "inputs"),
    work: path.join(top, "work"),
  };
  for (const directory of Object.values(created)) {
    mkdirSync(directory);
  }
  const state = path.join(top, "state");
  const ledgerDirectory = path.join(state, "review-ledger");
  return {
    ...created,
    ledgerDirectory,
    ledgerFile: path.join(ledgerDirectory, `${LEDGER_NAME}.json`),
    runs: 0,
    state,
  };
};

const write = (ws: Workspace, name: string, value: unknown): string => {
  const file = path.join(ws.inputs, name);
  writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value)
  );
  return file;
};

interface Inputs {
  policy?: unknown;
  receipts?: unknown[];
  /** `null` leaves the flag out. */
  review?: unknown;
}

/** The arguments of a run that is eligible unless something is changed. */
const gateArgs = (ws: Workspace, inputs: Inputs = {}): string[] => {
  const { policy = gatePolicy(), receipts = [receipt()], review } = inputs;
  return [
    "--repository",
    REPOSITORY,
    "--pull-request",
    String(PULL_REQUEST),
    "--policy",
    write(ws, "policy.json", policy),
    "--state",
    ws.state,
    "--run-id",
    RUN_ID,
    ...receipts.flatMap((item, index) => [
      "--receipt",
      write(ws, `receipt-${index}.json`, item),
    ]),
    ...(review === null
      ? []
      : [
          "--review-evidence",
          write(ws, "review.json", review ?? cleanReview()),
        ]),
  ];
};

/** `args` with the value of `flag` replaced, or the flag and its value removed. */
const change = (args: string[], flag: string, value: string | null) => {
  const index = args.indexOf(flag);
  return [
    ...args.slice(0, index),
    ...(value === null ? [] : [flag, value]),
    ...args.slice(index + 2),
  ];
};

interface RecordedRequest {
  body: string | null;
  cache: string | null;
  headers: Record<string, string>;
  method: string;
  redirect: string | null;
  url: string;
}

interface RunOptions {
  script?: GateScript;
  /** `null` leaves the variable unset. */
  token?: string | null;
  env?: Record<string, string>;
  preloads?: string[];
  cwd?: string;
}

const EXIT_CODES = { "invalid-input": 2, "not-collected": 3 } as const;

/**
 * Runs `forge gate` as a subprocess with the network replaced, and checks what
 * holds for every run: one JSON document on stdout, nothing on stderr, an exit
 * code that matches the document, and a token that appears nowhere but in the
 * `Authorization` header of requests to GitHub.
 */
const run = (ws: Workspace, args: string[], options: RunOptions = {}) => {
  const { token = TOKEN } = options;
  ws.runs += 1;
  const scriptFile = path.join(ws.harness, `script-${ws.runs}.json`);
  const requestsFile = path.join(ws.harness, `requests-${ws.runs}.jsonl`);
  writeFileSync(
    scriptFile,
    JSON.stringify(options.script ?? { passes: [pass()] })
  );
  writeFileSync(requestsFile, "");
  const child = Bun.spawnSync(
    [
      process.execPath,
      "--preload",
      preload,
      ...(options.preloads ?? []).flatMap((file) => ["--preload", file]),
      cli,
      "gate",
      ...args,
    ],
    {
      cwd: options.cwd ?? ws.work,
      env: {
        ...(token === null ? {} : { FORGE_GITHUB_TOKEN: token }),
        ...options.env,
        FORGE_GATE_TEST_REQUESTS: requestsFile,
        FORGE_GATE_TEST_SCRIPT: scriptFile,
      },
    }
  );
  const stdout = child.stdout.toString();
  const stderr = child.stderr.toString();
  expect(stderr).toBe("");
  expect(stdout.endsWith("\n")).toBe(true);
  expect(stdout.slice(0, -1)).not.toContain("\n");
  const document: GateDocument = JSON.parse(stdout);
  expect(document).toMatchObject({ kind: "forge-gate", schemaVersion: 1 });
  if (document.status === "evaluated") {
    const { evaluation } = document;
    expect(child.exitCode).toBe(document.eligible ? 0 : 1);
    expect(document.eligible).toBe(evaluation.eligible);
    // The evaluator's own result for the input it reports, and nothing else.
    expect<unknown>(evaluation).toEqual(
      evaluateEvidence(evaluation.input.facts, evaluation.input.policy)
    );
  } else {
    expect(child.exitCode).toBe(EXIT_CODES[document.status]);
    expect(document).not.toHaveProperty("eligible");
    expect(document).not.toHaveProperty("evaluation");
  }
  const requests: RecordedRequest[] = readFileSync(requestsFile, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(stdout).not.toContain(TOKEN);
  if (token) {
    expect(stdout).not.toContain(token);
  }
  for (const request of requests) {
    expect(request.url.startsWith(`${ORIGIN}/`)).toBe(true);
    expect(request.headers.authorization).toBe(`Bearer ${token}`);
    expect(request.redirect).toBe("error");
    expect(
      JSON.stringify({
        ...request,
        headers: { ...request.headers, authorization: "" },
      })
    ).not.toContain(String(token));
  }
  return { document, exitCode: child.exitCode, requests, stdout };
};

type Ran = ReturnType<typeof run>;

const evaluated = (ran: Ran) => {
  if (ran.document.status !== "evaluated") {
    throw new Error(`not evaluated: ${ran.stdout}`);
  }
  return ran.document;
};

const notCollected = (ran: Ran) => {
  if (ran.document.status !== "not-collected") {
    throw new Error(`collected: ${ran.stdout}`);
  }
  return ran.document;
};

const issues = (ran: Ran) => {
  if (ran.document.status !== "invalid-input") {
    throw new Error(`input accepted: ${ran.stdout}`);
  }
  return ran.document.issues;
};

const gate = (ran: Ran, name: GateName) => {
  const decision = evaluated(ran).evaluation.gates.find(
    (item) => item.name === name
  );
  return {
    codes: decision?.reasons.map((item) => item.code),
    paths: decision?.reasons.map((item) => item.path),
  };
};

/** Exit 1 with exactly these gates failed, in gate order. */
const expectOnlyFailed = (ran: Ran, ...failed: GateName[]) => {
  const document = evaluated(ran);
  expect(ran.exitCode).toBe(failed.length === 0 ? 0 : 1);
  expect(document.evaluation.gates.map((item) => item.name)).toEqual([
    ...GATE_NAMES,
  ]);
  expect(
    document.evaluation.gates
      .filter((item) => item.conclusion !== "success")
      .map((item) => item.name)
  ).toEqual(failed);
};

/** The collector's reads in the order it makes them: two passes of four. */
const READS = [
  `GET /repos/${REPOSITORY}/pulls/${PULL_REQUEST}/reviews`,
  `GET /repos/${REPOSITORY}/pulls/${PULL_REQUEST}`,
  `GET /repos/${REPOSITORY}/issues/${PULL_REQUEST}/timeline`,
  "POST /graphql",
  `GET /repos/${REPOSITORY}/pulls/${PULL_REQUEST}`,
  `GET /repos/${REPOSITORY}/pulls/${PULL_REQUEST}/reviews`,
  `GET /repos/${REPOSITORY}/issues/${PULL_REQUEST}/timeline`,
  "POST /graphql",
];
const made = (ran: Ran) =>
  ran.requests.map(
    (request) => `${request.method} ${new URL(request.url).pathname}`
  );

/** A valid stored entry, laid out as the store never writes it, so any rewrite shows. */
const seedLedger = (ws: Workspace, observedAt = "2024-01-01T00:00:00Z") => {
  mkdirSync(ws.ledgerDirectory, { recursive: true });
  const text = JSON.stringify(
    {
      observedRevision: { baseSha: BASE, headSha: HEAD, observedAt },
      requiredReviewers: [],
      reviewBindings: {},
    },
    null,
    2
  );
  writeFileSync(ws.ledgerFile, text);
  return text;
};
const ledgerText = (ws: Workspace) => readFileSync(ws.ledgerFile, "utf-8");

/** Each verification gate answered by its own declared check. */
const SEPARATE = { build: "build", lint: "lint", test: "test" };
const separateReceipts = () => VERIFICATION_GATES.map((name) => receipt(name));

test("a pull request that passes every gate is eligible and exits 0", () => {
  const ws = workspace();
  const ran = run(ws, gateArgs(ws));
  expect(ran.exitCode).toBe(0);
  expectOnlyFailed(ran);
  const document = evaluated(ran);
  expect(document).toMatchObject({
    eligible: true,
    rejectedReceipts: [],
    runId: RUN_ID,
    subject: {
      baseSha: BASE,
      headSha: HEAD,
      pullRequest: PULL_REQUEST,
      repository: REPOSITORY,
    },
  });
  expect(Object.keys(document).toSorted()).toEqual([
    "eligible",
    "evaluation",
    "kind",
    "rejectedReceipts",
    "runId",
    "schemaVersion",
    "status",
    "subject",
  ]);
  expect(document.evaluation).toMatchObject({
    agentReview: [{ disposition: "satisfied", pullRequest: PULL_REQUEST }],
    input: {
      facts: {
        event: "pull_request",
        pullRequest: {
          provenance: { ...policyV2().collector, runId: RUN_ID },
          ...cleanReview(),
        },
      },
      policy: policyV2(),
    },
    schemaVersion: 2,
    status: "evaluated",
  });
  expect(made(ran)).toEqual(READS);
  expect(JSON.parse(ledgerText(ws))).toEqual({
    observedRevision: {
      baseSha: BASE,
      headSha: HEAD,
      observedAt: "2024-01-01T01:00:00Z",
    },
    requiredReviewers: [],
    reviewBindings: {},
    reviewFindings: { findings: [], recorded: false },
  });
  expect(readdirSync(ws.state)).toEqual(["review-ledger"]);
  expect(readdirSync(ws.ledgerDirectory)).toEqual([`${LEDGER_NAME}.json`]);
});

test("input files resolve against the working directory, as a person at a terminal names them", () => {
  const ws = workspace();
  const args = gateArgs(ws).map((argument) =>
    argument.startsWith(ws.inputs)
      ? path.relative(ws.inputs, argument)
      : argument
  );
  // The state directory must still be outside the working directory.
  expect(run(ws, args, { cwd: ws.inputs }).exitCode).toBe(0);
});

test.each(VERIFICATION_GATES)(
  "a failed %s receipt fails that gate alone, and exits 1",
  (name) => {
    const ws = workspace();
    const receipts = VERIFICATION_GATES.map((id) =>
      receipt(
        id,
        id === name
          ? {
              diagnostic: "command-failed-unclassified",
              exitCode: 1,
              outcome: "failed",
            }
          : {}
      )
    );
    const ran = run(
      ws,
      gateArgs(ws, { policy: gatePolicy({ checks: SEPARATE }), receipts })
    );
    expectOnlyFailed(ran, name, "mergeability");
    expect(gate(ran, name).codes).toEqual(["check-not-passed"]);
    expect(gate(ran, "mergeability").codes).toEqual(["gate-blocked"]);
    expect(evaluated(ran).rejectedReceipts).toEqual([]);
  }
);

test.each(VERIFICATION_GATES)(
  "a missing %s receipt fails that gate alone, and exits 1",
  (name) => {
    const ws = workspace();
    const receipts = separateReceipts().filter(
      (item) => item.check?.id !== name
    );
    const ran = run(
      ws,
      gateArgs(ws, { policy: gatePolicy({ checks: SEPARATE }), receipts })
    );
    expectOnlyFailed(ran, name, "mergeability");
    expect(gate(ran, name).codes).toEqual(["missing-evidence"]);
  }
);

test("no receipt at all fails all three verification gates", () => {
  const ws = workspace();
  const ran = run(ws, gateArgs(ws, { receipts: [] }));
  expectOnlyFailed(ran, "lint", "test", "build", "mergeability");
});

test("without review evidence the agent-review gate fails for lack of evidence", () => {
  const ws = workspace();
  const ran = run(ws, gateArgs(ws, { review: null }));
  expectOnlyFailed(ran, "agent-review", "mergeability");
  expect(gate(ran, "agent-review").codes).toContain("missing-evidence");
  expect(gate(ran, "agent-review").paths).toContain(
    "facts.pullRequest.reviewFindings"
  );
  expect(evaluated(ran).evaluation.input.facts).toMatchObject({
    pullRequest: {
      agentReviews: [],
      reviewFindings: { findings: [], recorded: false },
      reviewLadder: null,
    },
  });
});

test("a finding the review evidence leaves unresolved fails agent-review alone", () => {
  const ws = workspace();
  const review = {
    ...cleanReview(),
    reviewFindings: { findings: [finding()], recorded: true },
  };
  const ran = run(ws, gateArgs(ws, { review }));
  expectOnlyFailed(ran, "agent-review", "mergeability");
  expect(gate(ran, "agent-review").codes).toContain("blocking-findings");
});

test("a receipt for another head fails its gates as a subject mismatch", () => {
  const ws = workspace();
  const moved = source("d".repeat(40));
  const stale = receipt("check", { sourceAfter: moved, sourceBefore: moved });
  const ran = run(ws, gateArgs(ws, { receipts: [stale] }));
  expectOnlyFailed(ran, "lint", "test", "build", "mergeability");
  expect(gate(ran, "lint").codes).toEqual(["subject-mismatch"]);
});

test("a requested reviewer who has not approved fails human-review alone", () => {
  const ws = workspace();
  const waiting = pass({
    pullRequest: {
      body: pullRequest({ requested_reviewers: [actorResponse()] }),
      date: SERVED,
    },
    timeline: { body: [reviewRequestedEvent()] },
  });
  const ran = run(ws, gateArgs(ws), { script: { passes: [waiting] } });
  expectOnlyFailed(ran, "human-review", "mergeability");
  expect(gate(ran, "human-review").codes).toEqual(["approval-required"]);
});

/** GitHub serving this pull request on both passes. */
const serving = (overrides: Record<string, unknown>): GateScript => ({
  passes: [
    pass({ pullRequest: { body: pullRequest(overrides), date: SERVED } }),
  ],
});
const labelled = (name: string) => serving({ labels: [{ id: 9, name }] });

test.each<[string, GateScript, string]>([
  ["a draft", serving({ draft: true }), "draft"],
  [
    "an unresolved review thread",
    {
      passes: [pass({ threads: { body: threadPageResponse([true, false]) } })],
    },
    "unresolvedThreads",
  ],
  ["the hold label, in any case", labelled("Forge:Hold"), "mergeAuthorized"],
  [
    "a head in a fork",
    serving({ head: { ref: "feature", repo: { id: 200 }, sha: HEAD } }),
    "mergeAuthorized",
  ],
  [
    "a head whose fork was deleted",
    serving({ head: { ref: "feature", repo: null, sha: HEAD } }),
    "mergeAuthorized",
  ],
  [
    "a pull request GitHub does not find mergeable",
    serving({ mergeable: false }),
    "mergeable",
  ],
  [
    "a pull request whose mergeability GitHub has not computed",
    serving({ mergeable: null }),
    "mergeable",
  ],
])("%s fails mergeability alone", (_name, script, field) => {
  const ws = workspace();
  const ran = run(ws, gateArgs(ws), { script });
  expectOnlyFailed(ran, "mergeability");
  expect(gate(ran, "mergeability")).toEqual({
    codes: ["landing-blocked"],
    paths: [`facts.pullRequest.${field}`],
  });
});

test("a closed pull request is not eligible", () => {
  const ws = workspace();
  const ran = run(ws, gateArgs(ws), { script: serving({ state: "closed" }) });
  expectOnlyFailed(ran, "mergeability");
  expect(gate(ran, "mergeability").paths).toContain("facts.pullRequest.open");
});

test("the hold label is the policy's, and no other label holds", () => {
  const policy = gatePolicy({
    mergeAuthorization: {
      holdLabel: "needs owner",
      rule: "same-repository-unless-held",
    },
  });
  const held = workspace();
  const blocked = run(held, gateArgs(held, { policy }), {
    script: labelled("needs owner"),
  });
  expectOnlyFailed(blocked, "mergeability");
  expect(gate(blocked, "mergeability").paths).toEqual([
    "facts.pullRequest.mergeAuthorized",
  ]);
  const free = workspace();
  expectOnlyFailed(
    run(free, gateArgs(free, { policy }), { script: labelled(HOLD) })
  );
});

test("an approval submitted after the first run's snapshot passes human-review on the second run", () => {
  const requested = { body: [reviewRequestedEvent()] };
  const first = {
    passes: [
      pass({
        pullRequest: {
          body: pullRequest({ requested_reviewers: [actorResponse()] }),
          date: SERVED_EARLY,
        },
        timeline: requested,
      }),
    ],
  };
  const second = {
    passes: [
      pass({
        reviews: { body: [reviewResponse({ submitted_at: APPROVED_AT })] },
        timeline: requested,
      }),
    ],
  };
  const ws = workspace();
  const before = run(ws, gateArgs(ws), { script: first });
  expectOnlyFailed(before, "human-review", "mergeability");
  expect(JSON.parse(ledgerText(ws))).toMatchObject({
    observedRevision: { observedAt: "2024-01-01T00:05:00Z" },
    requiredReviewers: [{ id: 7, kind: "user", login: "reviewer" }],
    reviewBindings: {},
  });
  const after = run(ws, gateArgs(ws), { script: second });
  expectOnlyFailed(after);
  expect(after.exitCode).toBe(0);
  expect(JSON.parse(ledgerText(ws))).toMatchObject({
    observedRevision: { observedAt: "2024-01-01T00:05:00Z" },
    reviewBindings: {
      "900": { observedAt: "2024-01-01T00:05:00Z", submittedAt: APPROVED_AT },
    },
  });

  // The same facts without the first run's ledger: the approval has no
  // recorded snapshot before it, so it binds to nothing.
  const fresh = workspace();
  const unbound = run(fresh, gateArgs(fresh), { script: second });
  expectOnlyFailed(unbound, "human-review", "mergeability");
  expect(gate(unbound, "human-review").codes).toEqual(["approval-required"]);
});

test("rejected receipts are reported by flag position and code, and their gates lack evidence", () => {
  const ws = workspace();
  const [lint, , build] = separateReceipts();
  const receipts = [
    lint,
    { [MARKER]: true },
    receipt("test", { repository: null }),
    build,
    receipt("unmapped"),
    [MARKER],
  ];
  const ran = run(
    ws,
    gateArgs(ws, { policy: gatePolicy({ checks: SEPARATE }), receipts })
  );
  expectOnlyFailed(ran, "test", "mergeability");
  expect(evaluated(ran).rejectedReceipts).toEqual([
    { code: "malformed-receipt", index: 1 },
    { code: "repository-missing", index: 2 },
    { code: "check-unmapped", index: 4 },
    { code: "malformed-receipt", index: 5 },
  ]);
  expect(gate(ran, "test").codes).toEqual(["missing-evidence"]);
  expect(ran.stdout).not.toContain(MARKER);
});

const everyRead = (response: { body: unknown; status?: number }) =>
  pass({
    pullRequest: response,
    reviews: response,
    threads: response,
    timeline: response,
  });

test.each<[string, GateScript, Record<string, unknown>, number]>([
  [
    "GitHub answers 404",
    { passes: [everyRead({ body: { message: MARKER }, status: 404 })] },
    {
      collection: { reason: "read-failed", status: "unavailable" },
      read: { code: "request-failed", status: 404 },
    },
    1,
  ],
  [
    "GitHub answers with a rate limit after the first read",
    {
      passes: [
        pass({
          pullRequest: { body: { message: MARKER }, status: 403 },
        }),
      ],
    },
    {
      collection: { reason: "read-failed", status: "unavailable" },
      read: { code: "request-failed", status: 403 },
    },
    2,
  ],
  [
    "GitHub answers with a redirect, as it does for a renamed repository",
    { passes: [everyRead({ body: { message: MARKER }, status: 301 })] },
    {
      collection: { reason: "read-failed", status: "unavailable" },
      read: { code: "request-failed", status: null },
    },
    1,
  ],
  [
    "a response reports a followed redirect",
    { passes: [pass({ reviews: { body: [], redirected: true } })] },
    {
      collection: { reason: "read-failed", status: "unavailable" },
      read: { code: "redirected", status: null },
    },
    1,
  ],
  [
    "the pull request response has no usable Date header",
    { passes: [pass({ pullRequest: { body: pullRequest() } })] },
    {
      collection: { reason: "read-failed", status: "unavailable" },
      read: { code: "date-header-unreadable", status: null },
    },
    2,
  ],
  [
    "the pull request changes between the two passes",
    {
      passes: [
        pass(),
        pass({
          pullRequest: {
            body: pullRequest({
              head: { ref: "feature", repo: { id: 100 }, sha: "c".repeat(40) },
            }),
            date: SERVED,
          },
        }),
      ],
    },
    {
      collection: { reason: "pull-request-changed", status: "changed" },
      read: null,
    },
    5,
  ],
  [
    "the response is for another repository",
    {
      passes: [
        pass({
          pullRequest: {
            body: pullRequest({
              base: {
                ref: "main",
                repo: { full_name: "example/other", id: 100 },
                sha: BASE,
              },
            }),
            date: SERVED,
          },
        }),
      ],
    },
    {
      collection: { reason: "repository-mismatch", status: "mismatch" },
      read: null,
    },
    2,
  ],
  [
    "a response does not parse",
    {
      passes: [
        pass({ reviews: { body: [reviewResponse({ state: MARKER })] } }),
      ],
    },
    {
      collection: {
        path: "reviews[0].state",
        reason: "response-unreadable",
        status: "unreadable",
      },
      read: null,
    },
    1,
  ],
])(
  "when %s the pull request is not collected: exit 3 and the ledger is untouched",
  (_name, script, expected, requestCount) => {
    const ws = workspace();
    const before = seedLedger(ws);
    const ran = run(ws, gateArgs(ws), { script });
    expect(ran.exitCode).toBe(3);
    expect<unknown>(notCollected(ran)).toStrictEqual({
      kind: "forge-gate",
      schemaVersion: 1,
      stage: "collection",
      status: "not-collected",
      ...expected,
    });
    expect(ran.requests).toHaveLength(requestCount);
    expect(ran.stdout).not.toContain(MARKER);
    expect(ledgerText(ws)).toBe(before);
    expect(readdirSync(ws.ledgerDirectory)).toEqual([`${LEDGER_NAME}.json`]);
  }
);

test("a failed collection with no stored ledger creates nothing in the state directory", () => {
  const ws = workspace();
  const ran = run(ws, gateArgs(ws), {
    script: { passes: [everyRead({ body: {}, status: 500 })] },
  });
  expect(notCollected(ran).stage).toBe("collection");
  expect(existsSync(ws.state)).toBe(false);
});

test.each<[string, (ws: Workspace) => string, string]>([
  [
    "is not JSON",
    (ws) => {
      mkdirSync(ws.ledgerDirectory, { recursive: true });
      writeFileSync(ws.ledgerFile, `{"${MARKER}":`);
      return ledgerText(ws);
    },
    "entry-invalid",
  ],
  [
    "breaks a rule",
    (ws) => {
      mkdirSync(ws.ledgerDirectory, { recursive: true });
      writeFileSync(ws.ledgerFile, JSON.stringify({ [MARKER]: MARKER }));
      return ledgerText(ws);
    },
    "entry-invalid",
  ],
  [
    "is ahead of the clock",
    (ws) => seedLedger(ws, "2999-01-01T00:00:00Z"),
    "entry-ahead-of-clock",
  ],
])(
  "a stored ledger that %s stops the run before GitHub is read: exit 3",
  (_name, seed, code) => {
    const ws = workspace();
    const before = seed(ws);
    const ran = run(ws, gateArgs(ws));
    expect(ran.exitCode).toBe(3);
    expect<unknown>(notCollected(ran)).toStrictEqual({
      code,
      kind: "forge-gate",
      schemaVersion: 1,
      stage: "ledger-read",
      status: "not-collected",
    });
    expect(ran.requests).toEqual([]);
    expect(ran.stdout).not.toContain(MARKER);
    expect(ran.stdout).not.toContain(ws.state);
    expect(ledgerText(ws)).toBe(before);
  }
);

test("an existing lock file stops the run after collection: exit 3, nothing evaluated, nothing stored", () => {
  const ws = workspace();
  const before = seedLedger(ws);
  const lock = path.join(ws.ledgerDirectory, `${LEDGER_NAME}.lock`);
  writeFileSync(lock, "");
  const ran = run(ws, gateArgs(ws));
  expect(ran.exitCode).toBe(3);
  expect(notCollected(ran)).toStrictEqual({
    code: "ledger-busy",
    kind: "forge-gate",
    schemaVersion: 1,
    stage: "ledger-store",
    status: "not-collected",
  });
  expect(made(ran)).toEqual(READS);
  expect(ledgerText(ws)).toBe(before);
  expect(existsSync(lock)).toBe(true);
});

test("an entry stored by another collection in between is a conflict: exit 3, nothing evaluated, the other entry kept", () => {
  const ws = workspace();
  seedLedger(ws);
  const other = JSON.stringify({
    observedRevision: {
      baseSha: BASE,
      headSha: HEAD,
      observedAt: "2024-01-01T00:30:00Z",
    },
    requiredReviewers: [],
    reviewBindings: {},
  });
  const ran = run(ws, gateArgs(ws), {
    script: {
      interference: { file: ws.ledgerFile, text: other },
      passes: [pass()],
    },
  });
  expect(ran.exitCode).toBe(3);
  expect(notCollected(ran)).toStrictEqual({
    code: "conflict",
    kind: "forge-gate",
    schemaVersion: 1,
    stage: "ledger-store",
    status: "not-collected",
  });
  expect(made(ran)).toEqual(READS);
  expect(ledgerText(ws)).toBe(other);
});

test.each([
  ["src/gate-policy.ts", "parseGatePolicy", 0],
  ["src/normalize-check-receipts.ts", "normalizeCheckReceipts", 8],
  ["src/evaluate-evidence.ts", "evaluateEvidence", 8],
])(
  "an unexpected exception from %s ends as exit 3 with nothing from the exception",
  (module, name, requestCount) => {
    const ws = workspace();
    const thrower = path.join(ws.harness, "thrower.ts");
    writeFileSync(
      thrower,
      'import { mock } from "bun:test"; mock.module(process.env.FORGE_TEST_THROW_MODULE, () => ({ [process.env.FORGE_TEST_THROW_EXPORT]: () => { throw new Error(process.env.FORGE_TEST_THROW_MESSAGE); } }));'
    );
    const ran = run(ws, gateArgs(ws), {
      env: {
        FORGE_TEST_THROW_EXPORT: name,
        FORGE_TEST_THROW_MESSAGE: MARKER,
        FORGE_TEST_THROW_MODULE: path.join(root, module),
      },
      preloads: [thrower],
    });
    expect(ran.exitCode).toBe(3);
    expect(notCollected(ran)).toStrictEqual({
      kind: "forge-gate",
      schemaVersion: 1,
      stage: "internal",
      status: "not-collected",
    });
    expect(ran.requests).toHaveLength(requestCount);
    expect(ran.stdout).not.toContain(MARKER);
  }
);

/** Exit 2, before anything was read from GitHub or made in the state directory. */
const expectRefused = (ws: Workspace, ran: Ran, where: string) => {
  expect(ran.exitCode).toBe(2);
  expect(issues(ran).map((issue) => issue.path)).toContain(where);
  expect(ran.requests).toEqual([]);
  expect(existsSync(ws.state)).toBe(false);
  expect(ran.stdout).not.toContain(MARKER);
};

const USAGE =
  "Usage: forge gate --repository <owner/name> --pull-request <number> --policy <file> --state <directory> --run-id <id> [--receipt <file>]... [--review-evidence <file>]";

const REQUIRED = [
  "--repository",
  "--pull-request",
  "--policy",
  "--state",
  "--run-id",
];

test.each(REQUIRED)(
  "a missing %s is invalid input with the usage line",
  (flag) => {
    const ws = workspace();
    const ran = run(ws, change(gateArgs(ws), flag, null));
    expectRefused(ws, ran, flag);
    expect(ran.document).toStrictEqual({
      issues: [{ message: "required", path: flag }],
      kind: "forge-gate",
      schemaVersion: 1,
      status: "invalid-input",
      usage: USAGE,
    });
  }
);

test("no arguments at all names every required flag", () => {
  const ws = workspace();
  const ran = run(ws, []);
  expect(issues(ran).map((issue) => issue.path)).toEqual(REQUIRED);
  expectRefused(ws, ran, "--policy");
});

test.each([...REQUIRED, "--review-evidence"])(
  "a repeated %s is invalid input",
  (flag) => {
    const ws = workspace();
    const args = gateArgs(ws);
    const value = args[args.indexOf(flag) + 1] ?? "";
    const ran = run(ws, [...args, flag, value]);
    expectRefused(ws, ran, flag);
    expect(ran.document).toMatchObject({ usage: USAGE });
  }
);

test.each<[string, (args: string[]) => string[], string]>([
  [
    "an unknown flag",
    (args) => [...args, `--${MARKER}`, "value"],
    "arguments[14]",
  ],
  ["a stray argument", (args) => [MARKER, ...args], "arguments[0]"],
  [
    "a flag with no value at the end",
    (args) => [...args, "--receipt"],
    "--receipt",
  ],
  [
    "a flag followed by another flag",
    (args) => [
      ...change(args, "--run-id", null),
      "--run-id",
      "--receipt",
      "x.json",
    ],
    "--run-id",
  ],
])("%s is invalid input and is not repeated", (_name, edit, where) => {
  const ws = workspace();
  const ran = run(ws, edit(gateArgs(ws)));
  expectRefused(ws, ran, where);
  expect(ran.document).toMatchObject({ usage: USAGE });
});

test.each<[string, string, string]>([
  ["--repository", "project", "a repository that is not owner/name"],
  ["--repository", "example/project/extra", "a repository with three parts"],
  ["--repository", "../project", "a repository with a dot segment"],
  [
    "--repository",
    "example/other",
    "a repository that differs from the policy's",
  ],
  ["--repository", "Example/Project", "a repository that differs only in case"],
  ["--pull-request", "0", "pull request zero"],
  ["--pull-request", "1.5", "a fractional pull request"],
  ["--pull-request", "012", "a pull request with a leading zero"],
  ["--pull-request", "9007199254740993", "an unsafe pull request number"],
  ["--pull-request", MARKER, "a pull request that is not a number"],
  ["--state", "state", "a relative state path"],
  ["--run-id", "", "an empty run ID"],
  ["--run-id", ` ${MARKER}`, "an untrimmed run ID"],
])("%s %p is invalid input: %s", (flag, value) => {
  const ws = workspace();
  const ran = run(ws, change(gateArgs(ws), flag, value));
  expectRefused(ws, ran, flag);
});

test("a state directory that is the working directory, or inside it, is invalid input", () => {
  const ws = workspace();
  const link = path.join(ws.harness, "link");
  symlinkSync(ws.work, link);
  for (const state of [
    ws.work,
    `${ws.work}${path.sep}`,
    path.join(ws.work, "state"),
    path.join(ws.work, "deep", "er", "state"),
    `${ws.work}${path.sep}..${path.sep}work${path.sep}state`,
    path.join(link, "state"),
  ]) {
    const ran = run(ws, change(gateArgs(ws), "--state", state));
    expectRefused(ws, ran, "--state");
    expect(readdirSync(ws.work)).toEqual([]);
  }
  // A sibling whose name only starts like the working directory is outside it.
  const sibling = `${ws.work}-state`;
  expect(run(ws, change(gateArgs(ws), "--state", sibling)).exitCode).toBe(0);
  expect(existsSync(path.join(sibling, "review-ledger"))).toBe(true);
});

test("a state directory reached through a symlink in the working directory is invalid input", () => {
  const ws = workspace();
  const outside = path.join(ws.harness, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(ws.work, "out"));
  const state = path.join(ws.work, "out", "state");
  expectRefused(ws, run(ws, change(gateArgs(ws), "--state", state)), "--state");
  expect(readdirSync(outside)).toEqual([]);
});

test.each<[string, RunOptions]>([
  ["no token", { token: null }],
  ["an empty token", { token: "" }],
  ["a token with a space in it", { token: "ghp_abc def" }],
  ["a token with a line break", { token: "ghp_abcdef\n" }],
  [
    "a token only in other variables",
    { env: { GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN }, token: null },
  ],
])("%s is invalid input", (_name, options) => {
  const ws = workspace();
  const ran = run(ws, gateArgs(ws), options);
  expectRefused(ws, ran, "FORGE_GITHUB_TOKEN");
  expect(ran.stdout).not.toContain("ghp_");
  expect(ran.document).not.toHaveProperty("usage");
});

test.each(["1", "true", "curl", "0", ""])(
  "verbose fetch set to %p is refused before any authenticated request",
  (value) => {
    const ws = workspace();
    const ran = run(ws, gateArgs(ws), {
      env: { BUN_CONFIG_VERBOSE_FETCH: value },
    });
    expectRefused(ws, ran, "BUN_CONFIG_VERBOSE_FETCH");
    expect(issues(ran)).toEqual([
      { message: "must be unset", path: "BUN_CONFIG_VERBOSE_FETCH" },
    ]);
  }
);

test.each<[string, string, (ws: Workspace) => string]>([
  ["--policy", "--policy", (ws) => path.join(ws.inputs, "missing.json")],
  ["--policy", "--policy", (ws) => ws.inputs],
  ["--policy", "--policy", (ws) => write(ws, "bad.json", `{"${MARKER}":`)],
  ["--receipt", "--receipt[0]", (ws) => path.join(ws.inputs, "missing.json")],
  ["--receipt", "--receipt[0]", (ws) => ws.inputs],
  ["--receipt", "--receipt[0]", (ws) => write(ws, "bad.json", `{"${MARKER}":`)],
  [
    "--review-evidence",
    "--review-evidence",
    (ws) => path.join(ws.inputs, "missing.json"),
  ],
  ["--review-evidence", "--review-evidence", (ws) => ws.inputs],
  [
    "--review-evidence",
    "--review-evidence",
    (ws) => write(ws, "bad.json", `{"${MARKER}":`),
  ],
])(
  "a %s file that cannot be read as JSON is invalid input (%#)",
  (flag, where, file) => {
    const ws = workspace();
    const ran = run(ws, change(gateArgs(ws), flag, file(ws)));
    expectRefused(ws, ran, where);
    expect(ran.stdout).not.toContain(ws.inputs);
    expect(ran.document).not.toHaveProperty("usage");
  }
);

test("the unreadable receipt is named by the position of its flag", () => {
  const ws = workspace();
  const ran = run(ws, [
    ...gateArgs(ws, { receipts: separateReceipts() }),
    "--receipt",
    path.join(ws.inputs, "missing.json"),
  ]);
  expectRefused(ws, ran, "--receipt[3]");
});

test.each<[string, unknown, string]>([
  [
    "without mergeAuthorization",
    Object.fromEntries(
      Object.entries(gatePolicy()).filter(
        ([key]) => key !== "mergeAuthorization"
      )
    ),
    "gatePolicy.mergeAuthorization",
  ],
  [
    "with another rule",
    gatePolicy({ mergeAuthorization: { holdLabel: HOLD, rule: MARKER } }),
    "gatePolicy.mergeAuthorization.rule",
  ],
  [
    "with version 1 evidence",
    gatePolicy({ evidence: { ...policyV2(), schemaVersion: 1 } }),
    "gatePolicy.evidence.schemaVersion",
  ],
  ["that is a list", [gatePolicy()], "gatePolicy"],
])("a policy %s is invalid input", (_name, policy, where) => {
  const ws = workspace();
  expectRefused(ws, run(ws, gateArgs(ws, { policy })), where);
});

test.each<[string, unknown, string]>([
  [
    "an extra key",
    { ...cleanReview(), surprise: MARKER },
    "reviewEvidence.surprise",
  ],
  [
    "a fact only the collector may supply",
    { ...cleanReview(), mergeAuthorized: true },
    "reviewEvidence.mergeAuthorized",
  ],
  [
    "checks only receipts may supply",
    { ...cleanReview(), checks: [] },
    "reviewEvidence.checks",
  ],
  [
    "a missing key",
    { agentReviews: [], reviewFindings: { findings: [], recorded: true } },
    "reviewEvidence.reviewLadder",
  ],
  ["a list in place of the object", [cleanReview()], "reviewEvidence"],
  ["a number in place of the object", 7, "reviewEvidence"],
])("review evidence with %s is invalid input", (_name, review, where) => {
  const ws = workspace();
  expectRefused(ws, run(ws, gateArgs(ws, { review })), where);
});

test.each<[string, Inputs, string]>([
  [
    "review evidence the evaluator refuses",
    { review: { ...cleanReview(), agentReviews: [{ attemptId: MARKER }] } },
    "facts.pullRequest.agentReviews[0]",
  ],
  [
    "an evidence policy the evaluator refuses",
    {
      policy: gatePolicy({
        evidence: {
          ...policyV2(),
          agentReview: { ...policyV2().agentReview, reviewers: [] },
        },
      }),
    },
    "policy.agentReview.reviewers",
  ],
])(
  "%s is invalid input, reported with the evaluator's issues",
  (_name, inputs, prefix) => {
    const ws = workspace();
    const ran = run(ws, gateArgs(ws, inputs));
    expect(ran.exitCode).toBe(2);
    const [issue] = issues(ran);
    expect(issue?.path.startsWith(prefix)).toBe(true);
    expect(issues(ran)).toHaveLength(1);
    expect(ran.document).not.toHaveProperty("usage");
    expect(ran.stdout).not.toContain(MARKER);
    // The evaluator sees the content only once the pull request is collected.
    expect(made(ran)).toEqual(READS);
  }
);

test("an unknown subcommand prints the usage error naming both subcommands", () => {
  for (const args of [[], ["wrong"], ["gates"]]) {
    const child = Bun.spawnSync(
      [process.execPath, "--preload", preload, cli, ...args],
      { env: {} }
    );
    expect(child.exitCode).toBe(2);
    expect(JSON.parse(child.stdout.toString())).toStrictEqual({
      diagnostic: `Usage: forge check [--config <file>] [--base <commit-oid>] | ${USAGE.slice("Usage: ".length)}`,
      kind: "forge-check-input-error",
      schemaVersion: 1,
    });
  }
});

test("invalid forge check arguments still print the forge check usage", () => {
  const child = Bun.spawnSync(
    [process.execPath, "--preload", preload, cli, "check", "--other", "x"],
    { env: {} }
  );
  expect(child.exitCode).toBe(2);
  expect(JSON.parse(child.stdout.toString())).toStrictEqual({
    diagnostic: "Usage: forge check [--config <file>] [--base <commit-oid>]",
    kind: "forge-check-input-error",
    schemaVersion: 1,
  });
});

const seedFindings = (ws: Workspace, findings: unknown[], recorded = true) => {
  seedLedger(ws);
  const ledger = JSON.parse(ledgerText(ws));
  writeFileSync(
    ws.ledgerFile,
    JSON.stringify({ ...ledger, reviewFindings: { findings, recorded } })
  );
};

test.each([
  { name: "omitted review evidence", review: null },
  { name: "supplied clean empty ledger", review: cleanReview() },
  {
    name: "supplied resolution override",
    review: {
      ...cleanReview(),
      reviewFindings: {
        findings: [finding({ resolution: nativeResolution() })],
        recorded: true,
      },
    },
  },
])("persisted unresolved findings block with $name", ({ review }) => {
  const ws = workspace();
  seedFindings(ws, [finding()]);
  const ran = run(ws, gateArgs(ws, { review }));
  expect(ran.exitCode).toBe(1);
  expect(gate(ran, "agent-review").codes).toContain("blocking-findings");
  expect(JSON.parse(ledgerText(ws)).reviewFindings).toEqual({
    findings: [finding()],
    recorded: true,
  });
});

test("persisted native resolution becomes blocking when its eligible reviewer is removed", () => {
  const ws = workspace();
  seedFindings(ws, [
    finding({ resolution: nativeResolution(), reviewer: HOSTED }),
  ]);
  const policy = policyV2();
  policy.agentReview.reviewers = policy.agentReview.reviewers.filter(
    (reviewer) => reviewer.reviewer !== HOSTED
  );
  const ran = run(
    ws,
    gateArgs(ws, { policy: gatePolicy({ evidence: policy }) })
  );
  expect(ran.exitCode).toBe(1);
  expect(gate(ran, "agent-review").codes).toContain("blocking-findings");
});

test("an external resolution downgrade stays conflicting and cannot replace persisted resolution", () => {
  const ws = workspace();
  const resolved = finding({
    resolution: nativeResolution(),
    reviewer: HOSTED,
  });
  seedFindings(ws, [resolved]);
  const review = {
    ...cleanReview(),
    reviewFindings: {
      findings: [{ ...resolved, resolution: null }],
      recorded: true,
    },
  };
  const ran = run(ws, gateArgs(ws, { review }));
  expect(ran.exitCode).toBe(1);
  expect(gate(ran, "agent-review").codes).toContain("duplicate-evidence");
  expect(gate(ran, "agent-review").codes).toContain("blocking-findings");
  expect(JSON.parse(ledgerText(ws)).reviewFindings.findings).toEqual([
    resolved,
  ]);
});

test("identical externally supplied persisted findings are deduplicated once", () => {
  const ws = workspace();
  const resolved = finding({
    resolution: nativeResolution(),
    reviewer: HOSTED,
  });
  seedFindings(ws, [resolved]);
  const review = {
    ...cleanReview(),
    reviewFindings: { findings: [resolved], recorded: true },
  };
  const ran = run(ws, gateArgs(ws, { review }));
  expect(ran.exitCode).toBe(0);
  expect(evaluated(ran).eligible).toBe(true);
});

test("duplicate external copies cannot be hidden by deduplication against persisted entries", () => {
  const ws = workspace();
  const resolved = finding({
    resolution: nativeResolution(),
    reviewer: HOSTED,
  });
  seedFindings(ws, [resolved]);
  const ran = run(
    ws,
    gateArgs(ws, {
      review: {
        ...cleanReview(),
        reviewFindings: { findings: [resolved, resolved], recorded: true },
      },
    })
  );
  expect(ran.exitCode).toBe(1);
  expect(gate(ran, "agent-review").codes).toContain("duplicate-evidence");
});

test("malformed external finding content keeps the ordinary invalid-input outcome", () => {
  const ws = workspace();
  seedFindings(ws, [finding()]);
  const ran = run(
    ws,
    gateArgs(ws, {
      review: {
        ...cleanReview(),
        reviewFindings: { findings: null, recorded: true },
      },
    })
  );
  expect(ran.exitCode).toBe(2);
  expect(issues(ran)[0]?.path).toBe(
    "facts.pullRequest.reviewFindings.findings"
  );
});

test("accepted findings survive a changed head and absent supplied evidence", () => {
  const ws = workspace();
  seedFindings(ws, [finding()], false);
  const changed = "d".repeat(40);
  const ran = run(ws, gateArgs(ws, { review: null }), {
    script: {
      passes: [
        pass({
          pullRequest: {
            body: pullRequest({
              head: { ref: "feature", repo: { id: 100 }, sha: changed },
            }),
            date: SERVED,
          },
        }),
      ],
    },
  });
  expect(gate(ran, "agent-review").codes).toContain("blocking-findings");
  expect(gate(ran, "agent-review").codes).toContain("findings-unknown");
  expect(JSON.parse(ledgerText(ws)).reviewFindings).toEqual({
    findings: [finding()],
    recorded: false,
  });
});
