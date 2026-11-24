import { afterEach, expect, test } from "bun:test";

import { gateExitCode } from "../src/gate-document.ts";
import type { GateOutputDocument } from "../src/gate-output.ts";
import type { ReviewCollectionState } from "../src/review-collection-types.ts";
import { runGate } from "../src/run-gate.ts";
import { HOSTED, LOCAL } from "./agent-review-fixtures.ts";
import {
  findingPass,
  findingSources,
  connection,
  sourceComments,
  invoke,
  report,
  scopedPolicy,
} from "./finding-sources-gate-fixtures.ts";
import { comment } from "./gate-codex-fixtures.ts";
import { pullRequest, SERVED } from "./gate-fixtures.ts";
import type { ScriptedResponse } from "./gate-fixtures.ts";
import {
  cleanupGateWorkspace,
  gateArgs,
  ledgerText,
  seedLedger,
  TOKEN,
  workspace,
} from "./gate-test-harness.ts";
import { issueCommentResponse } from "./github-fixtures.ts";
import { fakeAdapter, registry } from "./review-collection-fixtures.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanupGateWorkspace();
});

const sourceForMode = (mode: string) => {
  let source = findingPass();
  if (mode === "selected-pending") {
    source = findingPass({
      pullRequest: {
        body: pullRequest({
          head: { ref: "feature", repo: { id: 100 }, sha: "e".repeat(40) },
        }),
        date: SERVED,
      },
    });
  }
  if (mode === "selected-failed") {
    const adverseSummary = comment({
      has_any_findings: true,
      has_unresolved_findings: true,
    });
    source = findingPass({
      comments: sourceComments({
        ...adverseSummary,
        body: String(adverseSummary.body)
          .replace("private-code-review-body", "")
          .trim(),
      }),
    });
  }
  return source;
};
const primaryStates: Record<string, ReviewCollectionState> = {
  "selected-failed": "failed",
  "selected-pending": "pending",
};

const assertResolutionOnlyEvidence = (
  document: GateOutputDocument,
  state: ReviewCollectionState,
  passing: boolean
) => {
  if (
    document.status !== "evaluated" ||
    document.schemaVersion !== 2 ||
    document.evaluation.schemaVersion !== 2
  ) {
    throw new Error("expected evaluated schema2 document");
  }
  expect(
    document.reviewAdapters?.adapters.map(({ selected }) => selected)
  ).toEqual([true, false]);
  const primary = document.reviewAdapters?.adapters[0];
  expect(primary?.state).toBe(state);
  const reviewGate = document.evaluation.gates.find(
    ({ name }) => name === "agent-review"
  );
  expect(reviewGate?.conclusion).toBe(passing ? "success" : "failure");
  const { facts } = document.evaluation.input;
  if (facts.event !== "pull_request" || facts.schemaVersion !== 2) {
    throw new Error("expected scoped pull-request evaluation");
  }
  expect(
    facts.pullRequest.agentReviews.map(({ reviewer }) => reviewer)
  ).toEqual([HOSTED]);
  expect(
    facts.pullRequest.resolutionReviews?.map(({ reviewer }) => reviewer)
  ).toEqual([LOCAL]);
  expect(
    document.evaluation.agentReview?.[0]?.satisfiedBy?.every(
      (id) => !id.startsWith("secondary/")
    )
  ).toBe(true);
};

/** A trusted installed collector fixture supplies an explicit linkage to one retained entry. */
test.each([
  "missing-link",
  "linked",
  "wrong-target",
  "stale-review",
  "inherited-context",
  "implicit-own-resolution",
  "unselected-follow-up",
  "selected-pending",
  "selected-failed",
] as const)(
  "a trusted follow-up collector resolves only the explicitly linked entry (%s)",
  async (mode) => {
    const laterFollowUp = [
      "unselected-follow-up",
      "selected-pending",
      "selected-failed",
    ].includes(mode);
    const linked = [
      "linked",
      "unselected-follow-up",
      "selected-pending",
      "selected-failed",
    ].includes(mode);
    const passing = ["linked", "unselected-follow-up"].includes(mode);
    const ws = workspace();
    seedLedger(ws);
    const sources = findingSources();
    const policy =
      mode === "implicit-own-resolution"
        ? scopedPolicy({
            findingSources: {
              ...sources,
              sources: sources.sources.map((source) =>
                source.reviewer === "reporting-bot"
                  ? { ...source, reviewer: LOCAL }
                  : source
              ),
            },
          })
        : scopedPolicy();
    const adverse = issueCommentResponse({
      ...report({ body: "**Devin Review** found 1 potential issues." }),
      databaseId: 700,
    });
    expect(
      invoke(
        ws,
        [
          findingPass({
            findingReviews: {
              body: connection("reviews", [{ ...adverse, state: "COMMENTED" }]),
            },
          }),
        ],
        policy
      ).exitCode
    ).toBe(1);
    const [retained] = JSON.parse(ledgerText(ws)).reviewFindings.findings;
    if (retained === undefined) {
      throw new Error(ledgerText(ws));
    }
    expect(retained).toMatchObject({
      kind: "adverse-review",
      resolution: null,
      reviewer: mode === "implicit-own-resolution" ? LOCAL : "reporting-bot",
    });
    const source = sourceForMode(mode);
    const fetchFixture = (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit
    ): Promise<Response> => {
      const url = new URL(String(input));
      let answer: ScriptedResponse = source.pullRequest;
      if (url.pathname === "/graphql") {
        const { query } = JSON.parse(String(init?.body)) as { query: string };
        if (query.includes("ForgeFindingReviews")) {
          answer = source.findingReviews;
        } else if (query.includes("ForgeFindingThreads")) {
          answer = source.findingThreads;
        } else {
          answer = query.includes("reviewThreads(")
            ? source.threads
            : (source.comments ?? { body: {} });
        }
      } else if (url.pathname.endsWith("/reviews")) {
        answer = source.reviews;
      } else if (url.pathname.endsWith("/timeline")) {
        answer = source.timeline;
      }
      return Promise.resolve(
        Response.json(answer.body, {
          headers: {
            Date: source.pullRequest.date ?? "Mon, 01 Jan 2024 01:00:00 GMT",
          },
          status: answer.status ?? 200,
        })
      );
    };
    globalThis.fetch = Object.assign(fetchFixture, {
      preconnect: originalFetch.preconnect,
    });
    const followUp = fakeAdapter();
    const baseNormalize = followUp.normalize;
    followUp.normalize = (entry, observation, input) => {
      const result = baseNormalize(entry, observation, input);
      const [attempt] = result.agentReviews;
      if (attempt === undefined) {
        throw new Error("fixture lacks follow-up");
      }
      if (mode === "stale-review") {
        attempt.subject.headSha = "e".repeat(40);
      }
      if (mode === "inherited-context") {
        attempt.context = "inherited";
      }
      if (mode === "implicit-own-resolution") {
        result.reviewFindings.findings = result.reviewFindings.findings.map(
          (finding) => ({
            ...finding,
            resolution: {
              attemptId: attempt.attemptId,
              disposition: "fixed",
              kind: "follow-up-review",
              nativeRef: "fixture://secondary/implicit",
              provenance: entry.issuer,
              subject: input.subject,
            },
          })
        );
      } else if (mode !== "missing-link") {
        result.followUpResolutions = [
          {
            attemptId: attempt.attemptId,
            disposition: "fixed",
            finding: {
              attemptId: retained.attemptId,
              id: mode === "wrong-target" ? "unknown-entry" : retained.id,
              nativeRef: retained.nativeRef,
              reviewer: retained.reviewer,
            },
            nativeRef: "fixture://secondary/follow-up/retained-entry",
          },
        ];
      }
      return result;
    };
    const adapters = policy.reviewAdapters as Record<string, unknown>[];
    const followUpPolicy = {
      adapter: "secondary",
      configuration: {},
      reviewer: LOCAL,
    };
    const document = await runGate({
      adapterRegistry: { ...registry(), secondary: followUp },
      args: [
        ...gateArgs(ws, {
          policy: {
            ...policy,
            reviewAdapters: laterFollowUp
              ? [...adapters, followUpPolicy]
              : [followUpPolicy, ...adapters],
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
      passing ? 0 : 1
    );
    if (laterFollowUp) {
      assertResolutionOnlyEvidence(
        document,
        primaryStates[mode] ?? "passed",
        passing
      );
    }
    const [persisted] = JSON.parse(ledgerText(ws)).reviewFindings.findings;
    expect(persisted.id).toBe(retained.id);
    expect(persisted.resolution?.kind ?? null).toBe(
      linked ? "follow-up-review" : null
    );
  }
);
