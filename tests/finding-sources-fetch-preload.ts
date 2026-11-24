/** Adds the scoped review-body GraphQL read to the existing credential-free gate fixture. */
import { appendFileSync, readFileSync } from "node:fs";

import type { ScriptedResponse } from "./gate-fixtures.ts";

const previous = globalThis.fetch;
const count = { findingReviews: 0, findingThreads: 0 };
const record = (input: Parameters<typeof fetch>[0], init: RequestInit) => {
  appendFileSync(
    process.env.FORGE_GATE_TEST_REQUESTS ?? "",
    `${JSON.stringify({
      body: init.body ?? null,
      cache: init.cache ?? null,
      headers: Object.fromEntries(new Headers(init.headers)),
      method: init.method ?? "GET",
      redirect: init.redirect ?? null,
      url: String(input),
    })}\n`
  );
};
const scopedFetch = (
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {}
): Promise<Response> => {
  const url = new URL(String(input));
  const query =
    typeof init?.body === "string"
      ? (JSON.parse(init.body) as { query?: string }).query
      : undefined;
  const field = query?.includes("ForgeFindingThreads")
    ? "findingThreads"
    : "findingReviews";
  if (
    url.origin !== "https://api.github.com" ||
    url.pathname !== "/graphql" ||
    !query?.includes("ForgeFinding")
  ) {
    return previous(input, init);
  }
  const script = JSON.parse(
    readFileSync(process.env.FORGE_GATE_TEST_SCRIPT ?? "", "utf-8")
  ) as {
    passes: {
      findingReviews?: ScriptedResponse;
      findingThreads?: ScriptedResponse;
    }[];
  };
  const answer =
    script.passes[Math.min(count[field], script.passes.length - 1)]?.[field];
  count[field] += 1;
  record(input, init);
  if (answer === undefined) {
    throw new TypeError("unscripted scoped review read");
  }
  return Promise.resolve(
    Response.json(answer.body, {
      status: answer.status ?? 200,
    })
  );
};
Reflect.set(globalThis, "fetch", scopedFetch);
