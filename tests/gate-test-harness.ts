import { expect } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { GateDocument } from "../src/gate-document.ts";
import { evaluateEvidence } from "../src/index.ts";
import type { GateName } from "../src/index.ts";
import { BASE, HEAD, REPOSITORY } from "./evidence-fixtures.ts";
import {
  cleanReview,
  gatePolicy,
  pass,
  PULL_REQUEST,
  receipt,
} from "./gate-fixtures.ts";
import type { GateScript } from "./gate-fixtures.ts";

export const root = path.resolve(import.meta.dir, "..");
export const cli = path.join(root, "src/forge-cli.ts");
export const preload = path.join(root, "tests/gate-fetch-preload.ts");
const ORIGIN = "https://api.github.com";
/** Shaped like a credential, so a leak into output is easy to see. */
export const TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
export const RUN_ID = "build-4521";
export const LEDGER_NAME = `example+project+${PULL_REQUEST}`;

export interface Workspace {
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
export const cleanupGateWorkspace = () => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
};

export const workspace = (): Workspace => {
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

export const write = (ws: Workspace, name: string, value: unknown): string => {
  const file = path.join(ws.inputs, name);
  writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value)
  );
  return file;
};

export interface Inputs {
  policy?: unknown;
  receipts?: unknown[];
  /** `null` leaves the flag out. */
  review?: unknown;
}

/** The arguments of a run that is eligible unless something is changed. */
export const gateArgs = (ws: Workspace, inputs: Inputs = {}): string[] => {
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
export const change = (args: string[], flag: string, value: string | null) => {
  const index = args.indexOf(flag);
  return [
    ...args.slice(0, index),
    ...(value === null ? [] : [flag, value]),
    ...args.slice(index + 2),
  ];
};

export interface RecordedRequest {
  body: string | null;
  cache: string | null;
  headers: Record<string, string>;
  method: string;
  redirect: string | null;
  url: string;
}

export interface RunOptions {
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
export const run = (
  ws: Workspace,
  args: string[],
  options: RunOptions = {}
) => {
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

export type Ran = ReturnType<typeof run>;

export const evaluated = (ran: Ran) => {
  if (ran.document.status !== "evaluated") {
    throw new Error(`not evaluated: ${ran.stdout}`);
  }
  return ran.document;
};

export const notCollected = (ran: Ran) => {
  if (ran.document.status !== "not-collected") {
    throw new Error(`collected: ${ran.stdout}`);
  }
  return ran.document;
};

export const issues = (ran: Ran) => {
  if (ran.document.status !== "invalid-input") {
    throw new Error(`input accepted: ${ran.stdout}`);
  }
  return ran.document.issues;
};

export const gate = (ran: Ran, name: GateName) => {
  const decision = evaluated(ran).evaluation.gates.find(
    (item) => item.name === name
  );
  return {
    codes: decision?.reasons.map((item) => item.code),
    paths: decision?.reasons.map((item) => item.path),
  };
};

/** A valid stored entry, laid out as the store never writes it, so any rewrite shows. */
export const seedLedger = (
  ws: Workspace,
  observedAt = "2024-01-01T00:00:00Z"
) => {
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
export const ledgerText = (ws: Workspace) =>
  readFileSync(ws.ledgerFile, "utf-8");
