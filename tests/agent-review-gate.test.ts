import { expect, test } from "bun:test";

import type {
  AgentReviewAttempt,
  EvidenceFactsV2,
  EvidencePolicyV2,
  PullRequestFactsV2,
  ReasonCode,
} from "../src/index.ts";
import { evaluateEvidence } from "../src/index.ts";
import {
  exhausted,
  finding,
  followUp,
  FRESH_EYES,
  HOSTED,
  hostedAttempt,
  hostedReport,
  localAttempt,
  nativeResolution,
  passingFactsV2,
  passingGroupV2,
  passingPrV2,
  policyV2,
} from "./agent-review-fixtures.ts";
import { at, provenance, subject } from "./evidence-fixtures.ts";

const NEW_HEAD = "d".repeat(40);

const review = (
  facts: EvidenceFactsV2,
  requirements: EvidencePolicyV2 = policyV2()
) => {
  const result = evaluateEvidence(facts, requirements);
  if (result.status !== "evaluated" || result.schemaVersion !== 2) {
    throw new Error(JSON.stringify(result));
  }
  const gate = result.gates.find((item) => item.name === "agent-review");
  if (!gate) {
    throw new Error("missing agent-review gate");
  }
  return {
    codes: gate.reasons.map((item) => item.code),
    conclusion: gate.conclusion,
    eligible: result.eligible,
    outcomes: result.agentReview,
    reasons: gate.reasons,
  };
};

/** Facts whose PR presents exactly these attempts. */
const withAttempts = (
  ...attempts: AgentReviewAttempt[]
): PullRequestFactsV2 => {
  const facts = passingFactsV2();
  facts.pullRequest.agentReviews = attempts;
  return facts;
};

const blocked = (facts: EvidenceFactsV2, code: ReasonCode) => {
  const result = review(facts);
  expect(result.conclusion).toBe("failure");
  expect(result.eligible).toBe(false);
  expect(result.codes).toContain(code);
  expect(at(result.outcomes).disposition).not.toBe("satisfied");
  return result;
};

const passes = (facts: EvidenceFactsV2) => {
  const result = review(facts);
  expect(result.reasons).toEqual([]);
  expect(result.eligible).toBe(true);
  expect(at(result.outcomes).disposition).toBe("satisfied");
  return result;
};

test("one clean reviewer satisfies the gate while the rest are unavailable", () => {
  const result = passes(passingFactsV2());
  expect(result.outcomes).toEqual([
    { disposition: "satisfied", pullRequest: 1, satisfiedBy: ["ladder-1/2"] },
  ]);
});

test("a configured reviewer that never started is not required evidence", () => {
  passes(withAttempts(localAttempt()));
  passes(withAttempts(hostedReport()));
});

test("a pending attempt alone does not veto a clean alternate review", () => {
  passes(
    withAttempts(
      hostedAttempt({
        observedAt: "2026-01-01T00:05:00Z",
        state: "pending",
        unavailableReason: null,
      }),
      localAttempt()
    )
  );
});

test("a varied local review can supply the clean review", () => {
  passes(
    withAttempts(
      localAttempt({
        attemptId: "ladder-1/2",
        state: "unavailable",
        unavailableReason: "rate-limit",
        verdict: "unknown",
      }),
      localAttempt({
        attemptId: "ladder-1/3",
        instructions: FRESH_EYES,
        launch: "author-subagent",
        model: "fixture-model-b",
      })
    )
  );
});

test("every reviewer unavailable blocks without counting as clean", () => {
  const result = blocked(
    withAttempts(
      hostedAttempt(),
      localAttempt({
        state: "unavailable",
        unavailableReason: "error",
        verdict: "unknown",
      })
    ),
    "review-unavailable"
  );
  expect(result.codes).toEqual([
    "missing-evidence",
    "review-unavailable",
    "review-unavailable",
  ]);
  expect(at(result.outcomes)).toEqual({
    disposition: "blocked",
    pullRequest: 1,
    satisfiedBy: [],
  });
});

const exhaustedFacts = () => {
  const facts = withAttempts(
    hostedAttempt(),
    localAttempt({
      state: "unavailable",
      unavailableReason: "rate-limit",
      verdict: "unknown",
    })
  );
  facts.pullRequest.reviewLadder = exhausted();
  return facts;
};

test("an exhausted ladder is a distinct blocked result for a human", () => {
  const result = blocked(exhaustedFacts(), "ladder-exhausted");
  expect(at(result.outcomes).disposition).toBe("needs_human");
  expect(result.reasons).toContainEqual(
    expect.objectContaining({
      code: "ladder-exhausted",
      path: "facts.pullRequest.reviewLadder",
    })
  );
});

test("an ordinary human approval does not satisfy an exhausted ladder", () => {
  const facts = exhaustedFacts();
  facts.pullRequest.assignments.requiredReviewers = ["maintainer"];
  facts.pullRequest.humanReviews = [
    { reviewer: "maintainer", state: "approved", subject: subject() },
  ];
  const result = evaluateEvidence(facts, policyV2());
  if (result.status !== "evaluated") {
    throw new Error("expected an evaluated result");
  }
  const conclusions = Object.fromEntries(
    result.gates.map((item) => [item.name, item.conclusion])
  );
  expect(conclusions["human-review"]).toBe("success");
  expect(conclusions["agent-review"]).toBe("failure");
  expect(result.eligible).toBe(false);
});

test.each<[string, (facts: PullRequestFactsV2) => void, ReasonCode]>([
  [
    "an unexpected issuer",
    (facts) => {
      facts.pullRequest.reviewLadder = exhausted({
        provenance: provenance("agent"),
      });
    },
    "producer-mismatch",
  ],
  [
    "another revision",
    (facts) => {
      facts.pullRequest.reviewLadder = exhausted({
        subject: subject(1, NEW_HEAD),
      });
    },
    "subject-mismatch",
  ],
  [
    "a still-pending attempt",
    (facts) => {
      facts.pullRequest.agentReviews.push(
        localAttempt({
          attemptId: "ladder-1/3",
          state: "pending",
          verdict: "unknown",
        })
      );
    },
    "review-pending",
  ],
  [
    "a deadline that is not the configured wait",
    (facts) => {
      facts.pullRequest.agentReviews[0] = hostedAttempt({
        deadlineAt: "2026-01-01T00:01:00Z",
      });
    },
    "deadline-mismatch",
  ],
])("an exhaustion claim with %s is not accepted", (_name, mutate, code) => {
  const facts = exhaustedFacts();
  mutate(facts);
  const result = blocked(facts, code);
  expect(result.codes).not.toContain("ladder-exhausted");
  expect(at(result.outcomes).disposition).toBe("blocked");
});

test("an exhausted ladder keeps its unresolved findings in the result", () => {
  const facts = exhaustedFacts();
  facts.pullRequest.reviewFindings.findings = [finding()];
  const result = blocked(facts, "ladder-exhausted");
  expect(result.codes).toContain("blocking-findings");
  expect(at(result.outcomes).disposition).toBe("needs_human");
});

test.each<[string, (facts: PullRequestFactsV2) => void, ReasonCode]>([
  [
    "an unrecorded ledger",
    (facts) => {
      facts.pullRequest.reviewFindings.recorded = false;
    },
    "findings-unknown",
  ],
  [
    "an ambiguous ledger",
    (facts) => {
      facts.pullRequest.reviewFindings.findings = [finding(), finding()];
    },
    "duplicate-evidence",
  ],
  [
    "a reported finding missing from the ledger",
    (facts) => {
      facts.pullRequest.agentReviews.push(
        localAttempt({
          attemptId: "ladder-1/3",
          findingIds: ["F9"],
          verdict: "failed",
        })
      );
    },
    "missing-evidence",
  ],
])(
  "incomplete collection such as %s is not routed to a human",
  (_name, mutate, code) => {
    const facts = exhaustedFacts();
    mutate(facts);
    const result = blocked(facts, code);
    expect(result.codes).not.toContain("ladder-exhausted");
    expect(at(result.outcomes).disposition).toBe("blocked");
  }
);

test("an exhaustion claim never changes a satisfied gate", () => {
  const facts = passingFactsV2();
  facts.pullRequest.reviewLadder = exhausted();
  passes(facts);
});

test("a clean review does not clear another reviewer's unresolved finding", () => {
  const facts = withAttempts(
    hostedReport({ findingIds: ["T1"], verdict: "failed" }),
    localAttempt()
  );
  facts.pullRequest.reviewFindings.findings = [
    finding({ attemptId: "ladder-1/1", id: "T1", reviewer: HOSTED }),
  ];
  const result = blocked(facts, "blocking-findings");
  expect(result.reasons).toEqual([
    expect.objectContaining({
      code: "blocking-findings",
      path: "facts.pullRequest.reviewFindings.findings[0]",
    }),
  ]);
  expect(at(result.outcomes)).toEqual({
    disposition: "blocked",
    pullRequest: 1,
    satisfiedBy: ["ladder-1/2"],
  });
});

test.each([
  ["head", subject(1, NEW_HEAD)],
  ["base", subject(1, undefined, NEW_HEAD)],
  ["pull request", subject(2)],
  ["repository", { ...subject(), repository: "example/other" }],
])("a clean review bound to another %s cannot satisfy", (_name, bound) => {
  blocked(withAttempts(localAttempt({ subject: bound })), "subject-mismatch");
});

test("a review made after a new push leaves the earlier review stale", () => {
  const facts = passingFactsV2();
  const stale = facts.pullRequest.agentReviews;
  facts.pullRequest = passingPrV2(1, NEW_HEAD);
  facts.pullRequest.agentReviews = stale;
  blocked(facts, "subject-mismatch");
});

test.each(["inherited", "unknown"] as const)(
  "a review with %s context is not independent",
  (context) => {
    blocked(withAttempts(localAttempt({ context })), "review-not-independent");
  }
);

test("an author-spawned reviewer with a clean context is accepted", () => {
  passes(withAttempts(localAttempt({ launch: "author-subagent" })));
});

test.each<[string, Partial<AgentReviewAttempt>, ReasonCode]>([
  ["issuer", { provenance: provenance("collector") }, "producer-mismatch"],
  [
    "runtime",
    {
      provenance: {
        ...provenance("agent"),
        runtimeFingerprint: "9".repeat(64),
      },
    },
    "runtime-mismatch",
  ],
  ["reviewer", { reviewer: "unlisted-bot" }, "reviewer-not-acceptable"],
  ["rung", { reviewer: HOSTED }, "reviewer-not-acceptable"],
  ["instructions", { instructions: null }, "instructions-untrusted"],
  [
    "instruction digest",
    {
      instructions: { digest: "9".repeat(64), id: "general-review/standard@1" },
    },
    "instructions-untrusted",
  ],
  ["receipt", { nativeRef: null }, "review-incomplete"],
  ["completeness", { complete: false }, "review-incomplete"],
  ["findings", { findingIds: null }, "review-incomplete"],
  ["verdict", { verdict: "unknown" }, "review-incomplete"],
])(
  "a clean claim with an untrusted %s cannot satisfy",
  (_name, patch, code) => {
    blocked(withAttempts(localAttempt(patch)), code);
  }
);

test.each<[AgentReviewAttempt["state"], ReasonCode]>([
  ["failed", "review-incomplete"],
  ["canceled", "review-incomplete"],
  ["pending", "review-pending"],
])("a %s attempt cannot satisfy whatever else it claims", (state, code) => {
  blocked(withAttempts(localAttempt({ state })), code);
});

test("a hosted review outside the configured wait is not acceptable", () => {
  blocked(
    withAttempts(hostedReport({ deadlineAt: "2026-01-01T00:10:00Z" })),
    "deadline-mismatch"
  );
});

test("a status without findings data neither satisfies nor blocks", () => {
  const status = hostedReport({
    complete: false,
    findingIds: null,
    verdict: "unknown",
  });
  blocked(withAttempts(status), "review-incomplete");
  passes(withAttempts(status, localAttempt()));
});

test("an execution failure is not an adverse review", () => {
  passes(
    withAttempts(
      hostedAttempt({ state: "failed", unavailableReason: null }),
      localAttempt()
    )
  );
});

test("findings reported after a timeout still block", () => {
  const facts = withAttempts(
    hostedAttempt({ findingIds: ["T1"], observedAt: "2026-01-01T00:40:00Z" }),
    localAttempt()
  );
  facts.pullRequest.reviewFindings.findings = [
    finding({ attemptId: "ladder-1/1", id: "T1", reviewer: HOSTED }),
  ];
  blocked(facts, "blocking-findings");
  facts.pullRequest.reviewFindings.findings = [
    finding({
      attemptId: "ladder-1/1",
      id: "T1",
      resolution: nativeResolution(),
      reviewer: HOSTED,
    }),
  ];
  passes(facts);
});

test("an incomplete reviewer's finding still blocks", () => {
  const facts = withAttempts(
    localAttempt({
      attemptId: "ladder-1/1",
      complete: false,
      findingIds: ["F1"],
      verdict: "failed",
    }),
    localAttempt()
  );
  facts.pullRequest.reviewFindings.findings = [
    finding({ attemptId: "ladder-1/1" }),
  ];
  blocked(facts, "blocking-findings");
});

test("a finding whose attempt was dropped from the snapshot still blocks", () => {
  const facts = passingFactsV2();
  facts.pullRequest.reviewFindings.findings = [finding()];
  const result = blocked(facts, "blocking-findings");
  expect(at(result.outcomes).satisfiedBy).toEqual(["ladder-1/2"]);
});

test("a clean review of a new head does not clear an earlier finding", () => {
  const facts = passingFactsV2();
  facts.pullRequest = passingPrV2(1, NEW_HEAD);
  facts.pullRequest.reviewFindings.findings = [finding()];
  blocked(facts, "blocking-findings");
});

test("a detail-less failed verdict persists as an adverse-review entry", () => {
  const adverse = finding({
    attemptId: "ladder-0/1",
    id: "adverse:ladder-0/1",
    kind: "adverse-review",
  });
  const reported = withAttempts(
    localAttempt({
      attemptId: "ladder-0/1",
      findingIds: [adverse.id],
      verdict: "failed",
    })
  );
  reported.pullRequest.reviewFindings.findings = [adverse];
  blocked(reported, "blocking-findings");
  const later = passingFactsV2();
  later.pullRequest = passingPrV2(1, NEW_HEAD);
  later.pullRequest.reviewFindings.findings = [adverse];
  blocked(later, "blocking-findings");
});

test("an unrecorded finding ledger blocks", () => {
  const facts = passingFactsV2();
  facts.pullRequest.reviewFindings.recorded = false;
  const result = blocked(facts, "findings-unknown");
  expect(result.reasons).toHaveLength(1);
});

test("a reported finding missing from the ledger blocks", () => {
  const result = blocked(
    withAttempts(localAttempt({ findingIds: ["F9"] })),
    "missing-evidence"
  );
  expect(result.reasons).toContainEqual(
    expect.objectContaining({
      path: "facts.pullRequest.agentReviews[0].findingIds[0]",
    })
  );
});

test("an independent follow-up review explicitly resolves an earlier finding", () => {
  const facts = passingFactsV2();
  facts.pullRequest.reviewFindings.findings = [
    finding({ resolution: followUp() }),
    finding({ id: "F2", resolution: followUp({ disposition: "dismissed" }) }),
  ];
  passes(facts);
});

test("a failed follow-up can resolve one finding while raising another", () => {
  const facts = withAttempts(
    localAttempt({ findingIds: ["F2"], verdict: "failed" })
  );
  facts.pullRequest.reviewFindings.findings = [
    finding({ resolution: followUp() }),
    finding({ attemptId: "ladder-1/2", id: "F2" }),
  ];
  const result = blocked(facts, "blocking-findings");
  expect(
    result.reasons.filter((item) => item.path.includes("reviewFindings"))
  ).toEqual([
    expect.objectContaining({
      path: "facts.pullRequest.reviewFindings.findings[1]",
    }),
  ]);
});

test.each<[string, (facts: PullRequestFactsV2) => void]>([
  [
    "another head",
    (facts) => {
      at(facts.pullRequest.reviewFindings.findings).resolution = followUp({
        subject: subject(1, NEW_HEAD),
      });
    },
  ],
  [
    "another base",
    (facts) => {
      at(facts.pullRequest.reviewFindings.findings).resolution = followUp({
        subject: subject(1, undefined, NEW_HEAD),
      });
    },
  ],
  [
    "an unknown attempt",
    (facts) => {
      at(facts.pullRequest.reviewFindings.findings).resolution = followUp({
        attemptId: "ladder-9/9",
      });
    },
  ],
  [
    "an ambiguous attempt",
    (facts) => {
      facts.pullRequest.agentReviews.push(localAttempt());
    },
  ],
  [
    "an unexpected issuer",
    (facts) => {
      at(facts.pullRequest.reviewFindings.findings).resolution = followUp({
        provenance: provenance("collector"),
      });
    },
  ],
  [
    "the attempt that reported it",
    (facts) => {
      at(facts.pullRequest.reviewFindings.findings).attemptId = "ladder-1/2";
    },
  ],
  [
    "a follow-up that still reports it",
    (facts) => {
      facts.pullRequest.agentReviews[1] = localAttempt({
        findingIds: ["F1"],
        verdict: "failed",
      });
    },
  ],
  [
    "an incomplete follow-up",
    (facts) => {
      facts.pullRequest.agentReviews[1] = localAttempt({ complete: false });
    },
  ],
  [
    "a follow-up without a verdict",
    (facts) => {
      facts.pullRequest.agentReviews[1] = localAttempt({ verdict: "unknown" });
    },
  ],
  [
    "a follow-up with unknown findings",
    (facts) => {
      facts.pullRequest.agentReviews[1] = localAttempt({ findingIds: null });
    },
  ],
  [
    "a follow-up in the author's context",
    (facts) => {
      facts.pullRequest.agentReviews[1] = localAttempt({
        context: "inherited",
      });
    },
  ],
  [
    "a follow-up with unattested context",
    (facts) => {
      facts.pullRequest.agentReviews[1] = localAttempt({ context: "unknown" });
    },
  ],
  [
    "a follow-up with untrusted instructions",
    (facts) => {
      facts.pullRequest.agentReviews[1] = localAttempt({ instructions: null });
    },
  ],
  [
    "a follow-up by an unlisted reviewer",
    (facts) => {
      facts.pullRequest.agentReviews[1] = localAttempt({
        reviewer: "unlisted",
      });
    },
  ],
  [
    "a follow-up of another revision",
    (facts) => {
      facts.pullRequest.agentReviews[1] = localAttempt({
        subject: subject(1, NEW_HEAD),
      });
    },
  ],
])("a resolution citing %s is not accepted", (_name, mutate) => {
  const facts = passingFactsV2();
  facts.pullRequest.reviewFindings.findings = [
    finding({ resolution: followUp() }),
  ];
  mutate(facts);
  const result = blocked(facts, "blocking-findings");
  expect(result.reasons).toContainEqual(
    expect.objectContaining({
      code: "blocking-findings",
      path: "facts.pullRequest.reviewFindings.findings[0]",
    })
  );
});

test("a resolution goes stale when the head moves", () => {
  const facts = passingFactsV2();
  facts.pullRequest = passingPrV2(1, NEW_HEAD);
  facts.pullRequest.reviewFindings.findings = [
    finding({ resolution: followUp() }),
  ];
  blocked(facts, "blocking-findings");
});

test.each<[string, Parameters<typeof finding>[0]]>([
  ["a local reviewer's finding", { resolution: nativeResolution() }],
  [
    "a local reviewer's finding from its own issuer",
    { resolution: nativeResolution({ provenance: provenance("agent") }) },
  ],
  [
    "an unlisted reviewer's finding",
    { resolution: nativeResolution(), reviewer: "unlisted" },
  ],
  [
    "an unexpected issuer",
    {
      resolution: nativeResolution({ provenance: provenance("agent") }),
      reviewer: HOSTED,
    },
  ],
])("a native resolution for %s is not accepted", (_name, entry) => {
  const facts = passingFactsV2();
  facts.pullRequest.reviewFindings.findings = [finding(entry)];
  blocked(facts, "blocking-findings");
});

test("the same native ID under two reviewers is two findings", () => {
  const facts = passingFactsV2();
  facts.pullRequest.reviewFindings.findings = [
    finding({ id: "1", resolution: nativeResolution(), reviewer: HOSTED }),
    finding({ id: "1" }),
  ];
  const result = blocked(facts, "blocking-findings");
  expect(result.reasons).toEqual([
    expect.objectContaining({
      path: "facts.pullRequest.reviewFindings.findings[1]",
    }),
  ]);
  // A follow-up by another reviewer may report its own unrelated "1".
  const unrelated = withAttempts(localAttempt({ findingIds: ["1"] }));
  unrelated.pullRequest.reviewFindings.findings = [
    finding({ id: "1", resolution: followUp(), reviewer: HOSTED }),
    finding({
      attemptId: "ladder-1/2",
      id: "1",
      resolution: nativeResolution(),
    }),
  ];
  const second = review(unrelated);
  expect(second.reasons.map((item) => item.path)).not.toContain(
    "facts.pullRequest.reviewFindings.findings[0]"
  );
});

test("repeated ledger entries and attempt IDs are ambiguous", () => {
  const ledger = passingFactsV2();
  ledger.pullRequest.reviewFindings.findings = [
    finding({ resolution: followUp() }),
    finding({ resolution: followUp() }),
  ];
  blocked(ledger, "duplicate-evidence");
  blocked(withAttempts(localAttempt(), localAttempt()), "duplicate-evidence");
});

test("untrusted collection cannot report a satisfied review", () => {
  const facts = passingFactsV2();
  facts.pullRequest.provenance = provenance("agent");
  const result = blocked(facts, "producer-mismatch");
  expect(at(result.outcomes).satisfiedBy).toEqual(["ladder-1/2"]);
});

test("merge-group members each need their own clean review", () => {
  const group = passingGroupV2();
  expect(review(group).outcomes).toEqual([
    { disposition: "satisfied", pullRequest: 1, satisfiedBy: ["ladder-1/2"] },
  ]);
  const second = passingPrV2(2);
  second.agentReviews = [
    hostedAttempt({ subject: subject(2) }),
    localAttempt({
      state: "unavailable",
      subject: subject(2),
      unavailableReason: "error",
      verdict: "unknown",
    }),
  ];
  second.reviewLadder = exhausted({ subject: subject(2) });
  group.members.push(subject(2));
  group.admissions.push(second);
  const result = review(group);
  expect(result.conclusion).toBe("failure");
  expect(result.eligible).toBe(false);
  expect(result.outcomes.map((item) => item.disposition)).toEqual([
    "satisfied",
    "needs_human",
  ]);
});
