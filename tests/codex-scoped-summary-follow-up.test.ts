import { afterEach, expect, test } from "bun:test";

import type { ReviewFinding } from "../src/evidence-types.ts";
import { gateExitCode } from "../src/gate-document.ts";
import { runGate } from "../src/run-gate.ts";
import { LOCAL } from "./agent-review-fixtures.ts";
import {
  actor,
  findingPass,
  scopedPolicy,
  sourceComments,
} from "./finding-sources-gate-fixtures.ts";
import type { FindingPass } from "./finding-sources-gate-fixtures.ts";
import { BOT, codexPass, codexPolicy, comment } from "./gate-codex-fixtures.ts";
import type { ScriptedResponse } from "./gate-fixtures.ts";
import {
  cleanupGateWorkspace,
  gateArgs,
  ledgerText,
  run,
  seedLedger,
  TOKEN,
  workspace,
} from "./gate-test-harness.ts";
import { fakeAdapter, registry } from "./review-collection-fixtures.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanupGateWorkspace();
});
const mockSource = (source: FindingPass) => {
  const mocked = (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ): Promise<Response> => {
    const url = new URL(String(input));
    let response: ScriptedResponse = source.pullRequest;
    if (url.pathname === "/graphql") {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      if (query.includes("ForgeFindingReviews")) {
        response = source.findingReviews;
      } else if (query.includes("ForgeFindingThreads")) {
        response = source.findingThreads;
      } else {
        response = query.includes("reviewThreads(")
          ? source.threads
          : (source.comments ?? { body: {} });
      }
    } else if (url.pathname.endsWith("/reviews")) {
      response = source.reviews;
    } else if (url.pathname.endsWith("/timeline")) {
      response = source.timeline;
    }
    return Promise.resolve(
      Response.json(response.body, {
        headers: {
          Date: source.pullRequest.date ?? "Mon, 01 Jan 2024 01:00:00 GMT",
        },
        status: response.status ?? 200,
      })
    );
  };
  globalThis.fetch = Object.assign(mocked, {
    preconnect: originalFetch.preconnect,
  });
};
const origin = ({ resolution: _resolution, ...finding }: ReviewFinding) =>
  finding;

test.each(["same-report", "wrong-actor", "wrong-native-reference"] as const)(
  "a legacy Codex summary clears through an independent targeted follow-up only with current attribution (%s)",
  async (mode) => {
    const ws = workspace();
    seedLedger(ws);
    const summary = comment({
      has_any_findings: true,
      has_unresolved_findings: true,
    });
    const adverse = {
      ...summary,
      body: String(summary.body).replace("private-code-review-body", "").trim(),
    };
    const legacy = run(
      ws,
      gateArgs(ws, { policy: codexPolicy(), review: null }),
      {
        script: { passes: [codexPass({ comments: sourceComments(adverse) })] },
      }
    );
    expect(legacy.exitCode).toBe(1);
    const before: ReviewFinding[] = JSON.parse(ledgerText(ws)).reviewFindings
      .findings;
    expect(before).toHaveLength(1);
    const [original] = before;
    if (original === undefined) {
      throw new Error("legacy collector failed to retain the summary");
    }
    expect(original.id).toStartWith("adverse-review:500:");
    expect(original.reportingSource).toBeUndefined();
    const current: Record<string, unknown> = { ...adverse };
    if (mode === "wrong-actor") {
      Object.assign(current, {
        author: actor(BOT + 1),
        editor: actor(BOT + 1),
      });
    }
    if (mode === "wrong-native-reference") {
      current.url =
        "https://github.com/example/project/pull/12#issuecomment-999";
    }
    mockSource(findingPass({ comments: sourceComments(current) }));
    const followUp = fakeAdapter();
    const { normalize } = followUp;
    followUp.normalize = (entry, observation, input) => {
      const result = normalize(entry, observation, input);
      const [attempt] = result.agentReviews;
      if (attempt === undefined) {
        throw new Error("fixture lacks its independent follow-up");
      }
      result.followUpResolutions = [
        {
          attemptId: attempt.attemptId,
          disposition: "fixed",
          finding: {
            attemptId: original.attemptId,
            id: original.id,
            nativeRef: original.nativeRef,
            reviewer: original.reviewer,
          },
          nativeRef: "fixture://secondary/codex-summary-follow-up",
        },
      ];
      return result;
    };
    const policy = scopedPolicy();
    const document = await runGate({
      adapterRegistry: { ...registry(), secondary: followUp },
      args: [
        ...gateArgs(ws, {
          policy: {
            ...policy,
            reviewAdapters: [
              { adapter: "secondary", configuration: {}, reviewer: LOCAL },
              ...(policy.reviewAdapters as Record<string, unknown>[]),
            ],
          },
          review: null,
        }),
        "--output-version",
        "2",
      ],
      cwd: ws.work,
      env: { FORGE_GITHUB_TOKEN: TOKEN },
    });
    expect(gateExitCode(document), JSON.stringify(document)).toBe(
      mode === "same-report" ? 0 : 1
    );
    const after: ReviewFinding[] = JSON.parse(ledgerText(ws)).reviewFindings
      .findings;
    const retained = after.find(({ id }) => id === original.id);
    expect(retained).toBeDefined();
    if (retained === undefined) {
      throw new Error("scoped collection erased its accepted legacy origin");
    }
    expect(origin(retained)).toEqual(origin(original));
    expect(retained.resolution?.kind ?? null).toBe(
      mode === "same-report" ? "follow-up-review" : null
    );
    if (mode === "same-report") {
      expect(after).toHaveLength(1);
      expect(retained.resolution).toMatchObject({
        nativeRef: "fixture://secondary/codex-summary-follow-up",
      });
    }
  }
);
