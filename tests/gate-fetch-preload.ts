/**
 * Preloaded into the `forge gate` subprocess by `tests/forge-gate.test.ts`:
 * `bun --preload <this file> src/forge-cli.ts gate ...`. It replaces the
 * global `fetch`, so no test reaches the network. Requests to
 * `https://api.github.com` are answered from the script file named by
 * `FORGE_GATE_TEST_SCRIPT`; every request, answered or not, is appended as one
 * line of JSON to the file named by `FORGE_GATE_TEST_REQUESTS`. A request to
 * another origin, or one the script has no answer for, is recorded and fails.
 *
 * Never import this from a test: importing it replaces that process's `fetch`.
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { GateScript, ScriptedPass } from "./gate-fixtures.ts";

const ORIGIN = "https://api.github.com";

const script = (): GateScript => {
  const file = process.env.FORGE_GATE_TEST_SCRIPT;
  if (!file) {
    throw new TypeError("no script");
  }
  const parsed: GateScript = JSON.parse(readFileSync(file, "utf-8"));
  return parsed;
};

/** Which of the collector's reads a request is, or `null` for anything else. */
const readOf = (url: URL, init: RequestInit): keyof ScriptedPass | null => {
  if (url.origin !== ORIGIN) {
    return null;
  }
  if (url.pathname === "/graphql") {
    if (init.method !== "POST" || typeof init.body !== "string") {
      return null;
    }
    const body: { query?: string } = JSON.parse(init.body);
    return body.query?.includes("reviewThreads(") ? "threads" : "comments";
  }
  if ((init.method ?? "GET") !== "GET") {
    return null;
  }
  if (/^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/u.test(url.pathname)) {
    return "pullRequest";
  }
  if (/^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/u.test(url.pathname)) {
    return "reviews";
  }
  return /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/timeline$/u.test(url.pathname)
    ? "timeline"
    : null;
};

const made = {
  comments: 0,
  pullRequest: 0,
  reviews: 0,
  threads: 0,
  timeline: 0,
};
let requests = 0;

const record = (url: string, init: RequestInit): void => {
  const file = process.env.FORGE_GATE_TEST_REQUESTS;
  if (!file) {
    throw new TypeError("no request log");
  }
  appendFileSync(
    file,
    `${JSON.stringify({
      body: typeof init.body === "string" ? init.body : null,
      cache: init.cache ?? null,
      headers: Object.fromEntries(new Headers(init.headers)),
      method: init.method ?? "GET",
      redirect: init.redirect ?? null,
      url,
    })}\n`
  );
};

const fake = (url: string, init: RequestInit = {}): Promise<Response> => {
  record(url, init);
  const { interference, passes } = script();
  requests += 1;
  if (requests === 1 && interference !== undefined) {
    mkdirSync(path.dirname(interference.file), { recursive: true });
    writeFileSync(interference.file, interference.text);
  }
  const read = readOf(new URL(url), init);
  const answer =
    read === null
      ? undefined
      : passes[Math.min(made[read], passes.length - 1)]?.[read];
  if (read === null || answer === undefined) {
    return Promise.reject(new TypeError("unscripted request"));
  }
  made[read] += 1;
  const status = answer.status ?? 200;
  // The real `fetch` rejects a redirect it was told not to follow.
  if ([301, 302, 303, 307, 308].includes(status) && init.redirect === "error") {
    return Promise.reject(new TypeError("redirect refused"));
  }
  const response = Response.json(answer.body, {
    headers: answer.date === undefined ? {} : { date: answer.date },
    status,
  });
  if (answer.redirected) {
    Object.defineProperty(response, "redirected", { value: true });
  }
  return Promise.resolve(response);
};

// The real `fetch` also has methods this stand-in has no use for.
Reflect.set(globalThis, "fetch", fake);
