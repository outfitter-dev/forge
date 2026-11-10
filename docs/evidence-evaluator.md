# Deterministic evidence evaluation

Forge's first operation evaluates normalized evidence and explicit policy. Import `evaluateEvidence`, `validateEvidenceInput`, and their types from `src/index.ts`. Both functions are pure: no service calls, filesystem reads, credentials, clock, cache, reporting, process exits, or merge actions. CLI and CI adapters are separate follow-ups (FOR-3 and FOR-4).

```ts
import { evaluateEvidence } from "./src/index.ts";
import type { EvidenceFacts, EvidencePolicy } from "./src/index.ts";

const evaluate = (facts: EvidenceFacts, policy: EvidencePolicy) => {
  const result = evaluateEvidence(facts, policy);
  if (result.status === "invalid") {
    return result.issues;
  }
  return { eligible: result.eligible, gates: result.gates };
};
```

The public operation accepts unknown values so decoded external JSON follows the same validation path as typed callers. `validateEvidenceInput` exposes that boundary independently and returns a detached typed snapshot or validation issues. Evaluation validates its own detached snapshot before deciding. An evaluation cannot succeed by bypassing shape validation through a TypeScript assertion. Unsupported fields, events, schema versions, providers, and state values are invalid. The boundary reports the first shape error with a path and message; it does not collect all schema errors in one pass. Unexpected execution failures propagate to the caller and cannot produce an eligible result.

## Input and provenance

Facts and policy both use `schemaVersion: 1`. The exported types in [evidence-types.ts](../src/evidence-types.ts) define the complete contract. No compatibility with the pilot's JSON field names is implied.

| Input | Meaning |
| --- | --- |
| `policy.repository` | Explicit `owner/repository`; there is no default organization or credential identity. |
| `policy.collector` | Expected producer ID and trusted runtime/configuration fingerprint for PR state and candidate membership collection. |
| `policy.verification` | Expected producer ID and fingerprint for lint, test, and build receipts. |
| `policy.requiredAgentProviders` | A nonempty, unique list selecting `self-hosted`, `devin`, or both, with a separate producer ID and fingerprint for each. This selects evidence requirements; it does not invoke or qualify either integration. |
| `subject` | Repository, lowercase full 40-character head/base SHAs, and kind. PR subjects also require a positive safe-integer PR ID. Candidate subjects have kind `merge_group` and no PR ID. |
| `provenance` | Producer ID, lowercase 64-character runtime/configuration fingerprint, and nonempty run/receipt ID. |
| `checks` | Only normalized lint/test/build results. Collect exactly one authoritative result per required check. |
| `agentReviews` | Provider, original PR subject, provenance, execution state, explicit `complete` flag, verdict, and nonnegative safe-integer or unknown (`null`) blocking-findings count. |
| `assignments` | Whether the persisted assignment ledger was collected and its required human identities. Repeated historical assignments refer to the same required reviewer. |
| `humanReviews` | One effective decision per reviewer, with its original PR binding or `null` when unbound. |

Every check and agent review compares its subject and provenance with the subject under evaluation and explicit policy. Collector provenance is checked separately. Unknown landing facts use `null`; unknown findings/thread counts use `null`; absent observations use empty arrays. Missing required fields and malformed values are invalid rather than defaulted. An explicitly unknown or incomplete required fact blocks progression. Numeric booleans, negative/fractional counts, unsafe integers, short SHAs, and malformed fingerprints are rejected.

Fingerprints are supplied by the trusted caller, not computed by this operation. Their definition must cover the relevant trusted machinery/executable and task, model, harness, prompt, and semantic policy configuration. Changing a relevant setting requires new evidence under the corresponding new expected fingerprint. Do not hash a fingerprint field into itself. No runtime hashing, provider SDK, or cache implementation is supplied here.

The evaluated result includes the exact detached normalized input and policy, including source and runtime provenance. Reasons identify a stable code and path into that snapshot; prose messages are explanatory. Input array order determines reason order, and the six output gates always use `GATE_NAMES` order. These are normalized receipts and identifiers, not a place for credentials, logs, transcripts, or private runtime state.

## Decisions

| Gate | Passing requirement |
| --- | --- |
| `lint`, `test`, `build` | Exactly one result for that check, correct subject and producer/runtime binding, and state `passed`. Pending, failed, canceled, skipped, incomplete, and unknown cannot pass. |
| `agent-review` | Each configured provider has exactly one completed, explicitly complete, passing review for the PR revision, correct producer/runtime, and explicit zero blocking findings. A successful status without findings is insufficient. |
| `human-review` | Collected assignment history, one exact-source approval per assigned reviewer, and no outstanding changes requested by any reviewer. Duplicate effective decisions block. |
| `mergeability` | All preceding gates pass; each PR is explicitly open, non-draft, mergeable, authorized for landing, and has known-zero unresolved review threads. Merge groups also require complete current member admissions. |

An evaluation returns `status: "evaluated"`, `eligible`, and the six decisions with `success`/`failure` conclusions and structured reasons. Malformed input returns `status: "invalid"`, `eligible: false`, and validation issues; no gate results are invented when the contract cannot be evaluated. Eligibility is an input to a separately authorized landing operation, never a grant of permission or evidence that anything merged.

The optional `modelAssessment` is a small advisory claim (`verdict: "pass" | "block"`, plus explanation). The result labels it `authority: "advisory"`. Neither verdict changes deterministic decisions. Arbitrary model output must be mapped to this shape externally; an injected authority or override field is invalid.

## PR and merge-group semantics

PR facts use `event: "pull_request"` and `pullRequest` containing all PR evidence. The three verification decisions describe that PR's head/base. Agent and human reviews also bind to that PR's exact source.

Merge-group facts use `event: "merge_group"`, a `candidate` with integration checks and collection provenance, an authoritative `members` list of current PR subjects, and saved `admissions` containing full PR evidence. Membership must be nonempty, unique, and match admissions exactly by ID. Each admission must also match its independently collected member repository/head/base. Admission order is immaterial. Member bases are their collected PR bases; they are not automatically replaced with the candidate base.

The candidate's lint/test/build gates describe integration verification. Each member must additionally pass its own lint/test/build admission checks; failures appear in `mergeability`, leaving the candidate verification conclusions distinguishable. Agent/human gates aggregate member reviews on member revisions, not reviews on the candidate. Candidate and PR check subjects cannot substitute for one another even if SHAs match. Missing or ambiguous membership blocks agent/human decisions as well as eligibility, avoiding a vacuous review pass.

## Trusted collector responsibilities

**Shape validation is not producer authentication.** A well-formed forged JSON document can reproduce every expected identity and fingerprint. The evaluator cannot distinguish that forgery from authentic normalized evidence. Its comparisons only establish consistency with supplied policy.

Before normalization, the trusted collector must authenticate the actual producer, validate repository and original source binding, select the latest authoritative run with complete pagination and cancellation state, and preserve runtime identity. Adding current SHAs to an unbound provider response does not establish its revision. A green Devin check without validated findings data cannot become a clean review. Keep proposed code away from trusted orchestration, policy, and privileged credentials; use a trusted revision outside the proposed checkout.

Human assignment history must persist after GitHub removes a request on review submission. Expand team requests into an explicit supported human requirement, or leave the requirement unsatisfied. Supply the effective decision, retaining an earlier approval across comment-only reviews and applying subsequent dismissal or changes requested in submission-time order. Do not select approvals by creation ID alone. Voluntary outstanding objections remain blocking after a push/base change and even when their original source binding is unavailable. An assigned reviewer needs a fresh exact-head/base approval; dismissal satisfies no assigned approval requirement.

GitHub approvals do not expose their original base. The pilot establishes that binding through prior stable, timestamped observations; this evaluator assumes collection has established equivalent trustworthy evidence. An unobserved or ambiguous approval base must remain unbound (`subject: null`) and cannot pass for an assigned reviewer. The evaluator does not reconstruct assignment history, review chronology, historical bases, actor authority, or ledger integrity.

`mergeAuthorized` must come from an explicit trusted authorization rule for the repository and actor, with the referenced collection retaining its supporting evidence. A label by itself is not authorization. Collect authoritative candidate membership and current member revisions independently of stored admissions. Recollect mutable PR/queue state before a consequential action; hosted queue/ruleset enforcement remains necessary after the collection window.

## Source and deliberate adaptations

The behavioral baseline is pilot revision [`5264279b9ce776d2a8f8e6c3785c663d9b653cf8`](https://github.com/outfitter-dev/agentic-ci-pilot/commit/5264279b9ce776d2a8f8e6c3785c663d9b653cf8): `machinery/gates.py`, its 24 tests in `tests/test_gates.py`, and `docs/gate-contract.md`. Preparation found local pilot HEAD `897810f03bc14098809c5a113472649923d0d905` on the pre-squash implementation branch. All three requested files have identical blob IDs at that HEAD and the qualified baseline. The evaluator blob is `50e2e0d36c6611d6a0e641d09f883f17d64bfba5`; tests are `e7cd69338e11565e7e8345f7c81cce06bb9b47af`; contract is `c9834c74410dac27dad37a66d43a1d87d08cb4c2`.

Forge preserves the pilot's PR/candidate/member gate meanings and carries provenance checks from the pilot's surrounding `machinery/merge_queue.py` and `machinery/host_worker.py` source into explicit input. Deliberate adaptations are:

- A versioned, strict typed shape with arrays for reviews so duplicate observations remain visible. Unknown fields are rejected rather than silently accepted; missing observations and malformed containers remain distinguishable.
- Explicit repository, subject kind/PR ID, producer, run ID, and expected runtime/configuration fingerprints. Explicit `complete` is required for agent review, carrying forward the pilot cache's completion requirement.
- Current member revisions are supplied separately from saved admissions. Missing membership blocks review conclusions, as well as landing, rather than displaying successful empty aggregates.
- Collectors must exclude unrelated status contexts, including the evaluator's own mergeability status. The pilot ignored extra contexts; this contract rejects unsupported check names. No recursive gate dependency exists.
- Model claims use the small advisory shape above rather than round-tripping arbitrary provider output. No model verdict overrides or independently vetoes policy.

No provider response parser, authenticated collection, queue discovery, persistent admission store, cache, or pilot JSON compatibility adapter is implemented. These omissions do not permit unsupported facts to pass; the caller must supply the required normalized facts or receive blocked/invalid results.

## Offline qualification

Run `bun test tests/evaluate-evidence.test.ts tests/merge-group-evidence.test.ts tests/validate-evidence.test.ts` for the operation, then `bun run check` for all repository checks. [Fixture builders](../tests/evidence-fixtures.ts) produce complete passing PR and merge-group inputs with fictitious identities; the tests mutate them into blocked and malformed cases. For example, changing the PR test receipt's state to `failed` blocks its test gate and landing while retaining the other gate results. Removing a member admission blocks a candidate despite successful integration checks.

These fixtures prove deterministic behavior, input validation, provenance comparisons, and failure handling without credentials. They do not authenticate a producer, qualify live assigned-human approvals, validate Devin findings integration, prove concurrent queue refresh, or deploy Forge. Those live gaps remain separate work (FOR-9/FOR-11 and integration qualification). Existing pilot and product consumers remain unchanged.
