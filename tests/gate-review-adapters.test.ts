import { afterEach, expect, test } from "bun:test";

import { parseGatePolicy } from "../src/gate-policy.ts";
import { adoption, codexPass, codexPolicy } from "./gate-codex-fixtures.ts";
import { gatePolicy } from "./gate-fixtures.ts";
import {
  cleanupGateWorkspace,
  evaluated,
  gate,
  gateArgs,
  issues,
  run,
  seedLedger,
  workspace,
} from "./gate-test-harness.ts";

afterEach(cleanupGateWorkspace);

const adapter = (findingHistory = "adapter-only") => {
  const { reviewer, ...configuration } = adoption({ findingHistory });
  return { adapter: "codex-github", configuration, reviewer };
};
const policy = (reviewAdapters: unknown = [adapter()]) =>
  gatePolicy({ reviewAdapters, schemaVersion: 2 });

test("schema 2 explicitly normalizes the existing hosted adapter with the legacy meaning", () => {
  expect(parseGatePolicy(policy())).toEqual(parseGatePolicy(codexPolicy()));
  expect(parseGatePolicy(policy([]))).toEqual(parseGatePolicy(gatePolicy()));
});

test("the CLI collects the same review under schema 1 and schema 2", () => {
  const results = [codexPolicy(), policy()].map((configured) => {
    const ws = workspace();
    seedLedger(ws);
    return run(ws, gateArgs(ws, { policy: configured, review: null }), {
      script: { passes: [codexPass()] },
    });
  });
  for (const result of results) {
    expect(result.exitCode).toBe(0);
  }
  const [legacy, current] = results;
  if (!legacy || !current) {
    throw new Error("missing policy fixture");
  }
  expect(gate(current, "agent-review")).toEqual(gate(legacy, "agent-review"));
  expect(evaluated(current).evaluation.input.facts).toEqual(
    evaluated(legacy).evaluation.input.facts
  );
});

test("supplied-global-ledger still requires current complete external findings", () => {
  const ws = workspace();
  seedLedger(ws);
  const result = run(
    ws,
    gateArgs(ws, {
      policy: policy([adapter("supplied-global-ledger")]),
      review: null,
    }),
    { script: { passes: [codexPass()] } }
  );
  expect(result.exitCode).toBe(1);
  expect(gate(result, "agent-review").codes).toContain("findings-unknown");
});

test.each([
  { name: "invalid entries", value: null },
  { name: "unknown adapter", value: [{ ...adapter(), adapter: "unknown" }] },
  { name: "duplicate adapter", value: [adapter(), adapter()] },
  { name: "unexpected entry field", value: [{ ...adapter(), waitSeconds: 1 }] },
  {
    name: "legacy history claim",
    value: [adapter("codex-only")],
  },
  {
    name: "unknown configuration field",
    value: [
      {
        ...adapter(),
        configuration: { ...adapter().configuration, allowIncomplete: true },
      },
    ],
  },
])("the CLI refuses $name before reading GitHub", ({ value }) => {
  const ws = workspace();
  const result = run(ws, gateArgs(ws, { policy: policy(value), review: null }));
  expect(result.exitCode).toBe(2);
  expect(issues(result)[0]?.path).toStartWith("gatePolicy.reviewAdapters");
  expect(result.requests).toHaveLength(0);
});

test("policy versions refuse fields belonging to the other format", () => {
  expect(() =>
    parseGatePolicy({
      ...policy(),
      codexReview: adoption(),
    })
  ).toThrow("gatePolicy.codexReview");
  expect(() => parseGatePolicy(gatePolicy({ reviewAdapters: [] }))).toThrow(
    "gatePolicy.reviewAdapters"
  );
});

test("schema 2 requires the explicit adapter list", () => {
  const ws = workspace();
  const result = run(
    ws,
    gateArgs(ws, { policy: gatePolicy({ schemaVersion: 2 }), review: null })
  );
  expect(result.exitCode).toBe(2);
  expect(issues(result)[0]?.path).toBe("gatePolicy.reviewAdapters");
  expect(result.requests).toHaveLength(0);
});
