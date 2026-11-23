import { expect, test } from "bun:test";

import { collectPullRequest } from "../src/collect-pull-request.ts";
import { evaluateEvidence } from "../src/evaluate-evidence.ts";
import { gateReviewEvidence } from "../src/gate-review-evidence.ts";
import { passingFactsV2, policyV2 } from "./agent-review-fixtures.ts";
import {
  comment,
  pass,
  scripted,
  thread,
  threads,
} from "./codex-collection-fixtures.ts";
import { commentPageResponse } from "./github-fixtures.ts";
import { configuredRequest, registry } from "./review-collection-fixtures.ts";

const collect = async (source = scripted(), definitions = registry()) => {
  const result = await collectPullRequest(
    configuredRequest(),
    source.reads,
    definitions
  );
  if (result.status !== "collected" || result.reviewAdapters === undefined) {
    throw new Error(JSON.stringify(result));
  }
  const facts = passingFactsV2();
  facts.pullRequest.subject = result.evidence.subject;
  Object.assign(
    facts.pullRequest,
    gateReviewEvidence(
      result.ledger.reviewFindings,
      { ...result.reviewAdapters, reviewLadder: null },
      null
    )
  );
  const evaluation = evaluateEvidence(facts, policyV2());
  if (evaluation.status !== "evaluated") {
    throw new Error(JSON.stringify(evaluation));
  }
  return { evaluation, result: result.reviewAdapters };
};

test("an unavailable first adapter advances to the second on the normal collection path", async () => {
  const given = scripted(pass({ comments: [commentPageResponse([])] }));
  const { result, evaluation } = await collect(given);
  expect(result.adapters.map((item) => [item.state, item.selected])).toEqual([
    ["unavailable", true],
    ["passed", true],
  ]);
  expect(result.reviewFindings.recorded).toBe(true);
  expect(result.exhausted).toBe(false);
  expect(
    evaluation.gates.find((item) => item.name === "agent-review")?.conclusion
  ).toBe("success");
});

test("an unreadable first response advances without claiming it passed", async () => {
  const given = scripted(
    pass({
      comments: [
        commentPageResponse([
          comment({
            body: "<!-- codex-pull-request-review-summary --> malformed state",
          }),
        ]),
      ],
    })
  );
  const { result, evaluation } = await collect(given);
  expect(result.adapters[0]?.state).toBe("unreadable");
  expect(result.adapters[1]?.selected).toBe(true);
  expect(
    evaluation.gates.find((item) => item.name === "agent-review")?.conclusion
  ).toBe("success");
});

test("a later adverse verdict with no detailed findings blocks an earlier clean review", async () => {
  const { result, evaluation } = await collect(scripted(), registry("failed"));
  expect(result.adapters.map((item) => [item.state, item.selected])).toEqual([
    ["passed", true],
    ["failed", false],
  ]);
  expect(result.reviewFindings.findings).toContainEqual(
    expect.objectContaining({
      kind: "adverse-review",
      resolution: null,
      reviewer: "local-cli",
    })
  );
  expect(evaluation.eligible).toBe(false);
  expect(
    evaluation.gates.find((item) => item.name === "agent-review")?.reasons
  ).toContainEqual(expect.objectContaining({ code: "blocking-findings" }));
});

test("a later unreadable source leaves global history unknown even after a clean review", async () => {
  const { result, evaluation } = await collect(
    scripted(),
    registry("passed", true)
  );
  expect(result.adapters[1]).toMatchObject({
    diagnostics: ["source-unavailable"],
    selected: false,
    state: "unavailable",
  });
  expect(result.reviewFindings.recorded).toBe(false);
  expect(evaluation.eligible).toBe(false);
  expect(JSON.stringify(result)).not.toContain("PRIVATE SOURCE ERROR");
});

test("all unavailable or unreadable adapters report collection exhaustion", async () => {
  const given = scripted(pass({ comments: [commentPageResponse([])] }));
  const { result, evaluation } = await collect(given, registry("unreadable"));
  expect(result.exhausted).toBe(true);
  expect(result.adapters.every((item) => item.selected)).toBe(true);
  expect(evaluation.eligible).toBe(false);
});

test("a pending first review does not select the second clean attempt", async () => {
  const given = scripted(
    pass({
      comments: [
        commentPageResponse([
          comment({
            body: String(comment().body).replace('"completed"', '"running"'),
          }),
        ]),
      ],
    })
  );
  const { result, evaluation } = await collect(given);
  expect(result.adapters.map((item) => [item.state, item.selected])).toEqual([
    ["pending", true],
    ["passed", false],
  ]);
  expect(result.agentReviews).toHaveLength(1);
  expect(evaluation.eligible).toBe(false);
});

test("an empty collector list preserves unknown starting finding history", async () => {
  const source = scripted();
  const result = await collectPullRequest(
    { ...configuredRequest(), reviewAdapters: [] },
    source.reads
  );
  expect(result.status).toBe("collected");
  if (result.status === "collected") {
    expect(result.ledger.reviewFindings.recorded).toBe(false);
  }
  expect(source.calls).not.toContain("comments:null");
});

test.each(["unknown", "__proto__", "constructor"])(
  "unregistered adapter %s is refused before reads",
  async (adapter) => {
    const source = scripted();
    const request = configuredRequest();
    const [first] = request.reviewAdapters;
    if (first === undefined) {
      throw new Error("missing fixture adapter");
    }
    first.adapter = adapter;
    expect(await collectPullRequest(request, source.reads, registry())).toEqual(
      { reason: "request-malformed", status: "invalid-request" }
    );
    expect(source.calls).toEqual([]);
  }
);

test("a shared pull-request read failure retains the upstream collection failure", async () => {
  const source = scripted();
  source.reads.pullRequest = () =>
    Promise.reject(new Error("PRIVATE SOURCE ERROR"));
  expect(
    await collectPullRequest(configuredRequest(), source.reads, registry())
  ).toEqual({ reason: "read-failed", status: "unavailable" });
});

test("adapter capabilities and caller configuration are captured before source awaits", async () => {
  const source = scripted();
  const definitions = { ...registry() };
  const request = configuredRequest();
  const initialReviews = source.reads.reviews;
  source.reads.reviews = () => {
    const definition = definitions.secondary;
    if (definition === undefined) {
      throw new Error("missing fixture definition");
    }
    definition.normalize = () => {
      throw new Error("swapped definition");
    };
    source.reads.issueComments = () =>
      Promise.reject(new Error("swapped source"));
    request.reviewAdapters.splice(0);
    return initialReviews();
  };
  const result = await collectPullRequest(request, source.reads, definitions);
  expect(result.status).toBe("collected");
  if (result.status === "collected") {
    expect(result.reviewAdapters?.adapters.map((entry) => entry.state)).toEqual(
      ["passed", "passed"]
    );
    expect(result.reviewAdapters?.reviewFindings.recorded).toBe(true);
  }
});

test("stable native thread findings persist even when the adapter's extra source is unavailable", async () => {
  const source = scripted(pass({ threads: threads(thread()) }));
  source.reads.issueComments = () => Promise.reject(new Error("source outage"));
  const result = await collectPullRequest(
    configuredRequest(),
    source.reads,
    registry()
  );
  expect(result.status).toBe("collected");
  if (result.status === "collected") {
    expect(result.ledger.reviewFindings.findings).toContainEqual(
      expect.objectContaining({
        id: "T1",
        resolution: null,
        reviewer: "hosted-bot",
      })
    );
    expect(result.ledger.reviewFindings.recorded).toBe(false);
  }
});

test("an adverse report from either changed source pass survives a later stable clean report", async () => {
  const adverse = String(comment().body)
    .replaceAll('"has_any_findings":false', '"has_any_findings":true')
    .replaceAll(
      '"has_unresolved_findings":false',
      '"has_unresolved_findings":true'
    );
  const source = scripted(
    pass({ comments: [commentPageResponse([comment({ body: adverse })])] }),
    pass()
  );
  const initial = await collectPullRequest(
    configuredRequest(),
    source.reads,
    registry()
  );
  expect(initial.status).toBe("collected");
  if (initial.status !== "collected") {
    return;
  }
  expect(initial.ledger.reviewFindings.findings).toContainEqual(
    expect.objectContaining({
      kind: "adverse-review",
      resolution: null,
      reviewer: "hosted-bot",
    })
  );
  const next = await collectPullRequest(
    { ...configuredRequest(), ledger: initial.ledger },
    scripted().reads,
    registry()
  );
  expect(next.status).toBe("collected");
  if (next.status === "collected") {
    expect(next.ledger.reviewFindings.findings).toEqual(
      initial.ledger.reviewFindings.findings
    );
    expect(next.ledger.reviewFindings.recorded).toBe(true);
  }
});
