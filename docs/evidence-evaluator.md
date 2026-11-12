# Deterministic evidence evaluation

Forge's first operation evaluates normalized evidence and explicit policy. Import `evaluateEvidence`, `validateEvidenceInput`, and their types from `src/index.ts`. Both functions are pure: no service calls, filesystem reads, credentials, clock, cache, reporting, process exits, or merge actions. The [local JSON CLI](evidence-cli.md) is a separate adapter (FOR-3); [CI fixture qualification](evidence-cli.md#ci-adapter-qualification) runs that same entry point through its subprocess suite (FOR-4).

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

Facts and policy carry the same `schemaVersion`, either 1 or 2. The versions differ only in agent review. This section and the next describe version 1; [agent review under schema version 2](#agent-review-under-schema-version-2) describes what version 2 replaces. A record is evaluated only under its own version: mixed versions are invalid, a relabeled record fails shape validation, and version 1 keeps the meaning stated here. The exported types in [evidence-types.ts](../src/evidence-types.ts) define the complete contract. No compatibility with the pilot's JSON field names is implied.

| Input | Meaning |
| --- | --- |
| `policy.repository` | Explicit `owner/repository`; there is no default organization or credential identity. |
| `policy.collector` | Expected producer ID and trusted runtime/configuration fingerprint for PR state and candidate membership collection. |
| `policy.verification` | Expected producer ID and fingerprint for lint, test, and build receipts. |
| `policy.requiredAgentProviders` | Version 1 only. A nonempty, unique list selecting `self-hosted`, `devin`, or both, with a separate producer ID and fingerprint for each. This selects evidence requirements; it does not invoke or qualify either integration. |
| `subject` | Repository, lowercase full 40-character head/base SHAs, and kind. PR subjects also require a positive safe-integer PR ID. Candidate subjects have kind `merge_group` and no PR ID. |
| `provenance` | Producer ID, lowercase 64-character runtime/configuration fingerprint, and nonempty run/receipt ID. |
| `checks` | Only normalized lint/test/build results. Collect exactly one authoritative result per required check. |
| `agentReviews` | Version 1 shape: provider, original PR subject, provenance, execution state, explicit `complete` flag, verdict, and nonnegative safe-integer or unknown (`null`) blocking-findings count. |
| `assignments` | Whether the persisted assignment ledger was collected and its required human identities. Repeated historical assignments refer to the same required reviewer. |
| `humanReviews` | One effective decision per reviewer, with its original PR binding or `null` when unbound. |

Every check and agent review compares its subject and provenance with the subject under evaluation and explicit policy. Collector provenance is checked separately. Unknown landing facts use `null`; unknown findings/thread counts use `null`; absent observations use empty arrays. Missing required fields and malformed values are invalid rather than defaulted. An explicitly unknown or incomplete required fact blocks progression. Numeric booleans, negative/fractional counts, unsafe integers, short SHAs, and malformed fingerprints are rejected.

Fingerprints are supplied by the trusted caller, not computed by this operation. Their definition must cover the relevant trusted machinery/executable and task, model, harness, prompt, and semantic policy configuration. Changing a relevant setting requires new evidence under the corresponding new expected fingerprint. Do not hash a fingerprint field into itself. No runtime hashing, provider SDK, or cache implementation is supplied here.

The evaluated result includes the exact detached normalized input and policy, including source and runtime provenance. Reasons identify a stable code and path into that snapshot; prose messages are explanatory. Input array order determines reason order, and the six output gates always use `GATE_NAMES` order. These are normalized receipts and identifiers, not a place for credentials, logs, transcripts, or private runtime state.

## Decisions

| Gate | Passing requirement |
| --- | --- |
| `lint`, `test`, `build` | Exactly one result for that check, correct subject and producer/runtime binding, and state `passed`. Pending, failed, canceled, skipped, incomplete, and unknown cannot pass. |
| `agent-review` | Version 1: each configured provider has exactly one completed, explicitly complete, passing review for the PR revision, correct producer/runtime, and explicit zero blocking findings. A successful status without findings is insufficient. Version 2: [one credible clean review from any eligible reviewer and no unresolved ledger entry](#the-gate). |
| `human-review` | Collected assignment history, one exact-source approval per assigned reviewer, and no outstanding changes requested by any reviewer. Duplicate effective decisions block. |
| `mergeability` | All preceding gates pass; each PR is explicitly open, non-draft, mergeable, authorized for landing, and has known-zero unresolved review threads. Merge groups also require complete current member admissions. |

An evaluation returns `status: "evaluated"`, the input's `schemaVersion`, `eligible`, and the six decisions with `success`/`failure` conclusions and structured reasons. A version 2 result also carries `agentReview`, described below. Malformed input returns `status: "invalid"`, `eligible: false`, and validation issues; no gate results are invented when the contract cannot be evaluated. Eligibility is an input to a separately authorized landing operation, never a grant of permission or evidence that anything merged.

The optional `modelAssessment` is a small advisory claim (`verdict: "pass" | "block"`, plus explanation). The result labels it `authority: "advisory"`. Neither verdict changes deterministic decisions. Arbitrary model output must be mapped to this shape externally; an injected authority or override field is invalid.

## PR and merge-group semantics

PR facts use `event: "pull_request"` and `pullRequest` containing all PR evidence. The three verification decisions describe that PR's head/base. Agent and human reviews also bind to that PR's exact source.

Merge-group facts use `event: "merge_group"`, a `candidate` with integration checks and collection provenance, an authoritative `members` list of current PR subjects, and saved `admissions` containing full PR evidence. Membership must be nonempty, unique, and match admissions exactly by ID. Each admission must also match its independently collected member repository/head/base. Admission order is immaterial. Member bases are their collected PR bases; they are not automatically replaced with the candidate base.

The candidate's lint/test/build gates describe integration verification. Each member must additionally pass its own lint/test/build admission checks; failures appear in `mergeability`, leaving the candidate verification conclusions distinguishable. Agent/human gates aggregate member reviews on member revisions, not reviews on the candidate. Candidate and PR check subjects cannot substitute for one another even if SHAs match. Missing or ambiguous membership blocks agent/human decisions as well as eligibility, avoiding a vacuous review pass.

## Agent review under schema version 2

On November 11, 2026 the project owner decided that Forge has no required review provider (FOR-26). Providers hit rate limits and outages, and a change must not wait indefinitely on a reviewer that will not report. The gate still requires a review. Version 2 changes who may supply it and adds a persisted record of what reviewers found.

The shape was agreed with Ranger, which owns running reviews: choosing reviewers and models, applying guidance, starting clean-context reviewers, enforcing deadlines, and looping. Forge runs no review loop, selects no model, and calls no provider. It states what the resulting evidence must show.

Version 1 is unchanged. A version 1 policy still requires every provider in `requiredAgentProviders`, and version 1 evidence is never evaluated under the rules below.

### Policy

`policy.agentReview` replaces `requiredAgentProviders`.

| Field | Meaning |
| --- | --- |
| `reviewers` | Nonempty list of eligible reviewers, unique by `reviewer`. Each entry has an open string identity, a `rung` (`hosted` or `local`), and the expected `producer` and `runtimeFingerprint` of whoever issues that reviewer's receipts. Adding a reviewer is configuration, not a type change. A listed reviewer is a choice, not a requirement: one that never starts needs no evidence. |
| `reviewers[].waitSeconds` | Required for `hosted`, rejected for `local`. The consumer's finite wait for that reviewer, a positive whole number of seconds. There is no default. |
| `instructions` | The fixed review guidance a local reviewer may be launched with, each an `id` and a 64-character `digest`. Required when any reviewer is local. |
| `ladder` | Expected `producer` and `runtimeFingerprint` of a ladder exhaustion attestation. |

### Attempts

`pullRequest.agentReviews` lists the review attempts that actually started. Each attempt has these fields, all required; `null` means unknown or not applicable, never a default.

| Field | Meaning |
| --- | --- |
| `kind` | Always `general-review`. Tenet shadow evidence is a separate contract (FOR-13) with no slot in this gate, so it can neither satisfy nor block it; any other kind is invalid input. |
| `attemptId` | Stable identifier, unique within the snapshot. |
| `reviewer`, `rung` | The reviewer identity and its rung. Both must match a policy entry for the attempt to count. |
| `subject` | The exact repository, PR, head, and base reviewed. |
| `provenance` | Issuer `producer`, `runtimeFingerprint`, and `runId` of the receipt. |
| `model`, `harness` | Recorded identities, so varied attempts are distinguishable. Not evaluated. |
| `instructions` | The guidance identity the reviewer was launched with, or `null` for a hosted service. |
| `launch` | `separate-invocation`, `author-subagent`, or `unknown`. Recorded so a consumer can later require the stronger form. Both known values are accepted today. |
| `context` | `none`, `inherited`, or `unknown`. Only `none` is independent. For a hosted reviewer it is `none` only under a [policy attestation](hosted-reviewer-attestations.md). |
| `startedAt`, `deadlineAt`, `observedAt` | Whole-second UTC times such as `2026-01-01T00:15:00Z`. `startedAt` is when the trusted orchestrator or collector began waiting, not the provider's own job start. A later poll keeps it; it never restarts the deadline. `deadlineAt` is required for hosted attempts. `observedAt` is the snapshot time. |
| `state` | `completed`, `pending`, `failed`, `canceled`, or `unavailable`, as in version 1. |
| `unavailableReason` | `rate-limit`, `error`, `timeout`, or `unknown` when the state is `unavailable`; otherwise `null`. |
| `complete`, `verdict` | As in version 1: an explicit completeness flag, and `passed`, `failed`, or `unknown`. |
| `findingIds` | The ledger entries this attempt reported, by that reviewer's native IDs. `null` means the findings are unknown, which is not the same as none. |
| `nativeRef` | Durable reference to the provider's or Ranger's own receipt. |

Shape validation rejects an attempt that contradicts itself, so these are invalid input rather than a blocked gate: an observation before `startedAt`; a deadline at or before `startedAt`; a hosted attempt without a deadline; a `timeout` whose deadline is missing or not yet reached at `observedAt`; and a `failed` verdict that references no ledger entry.

### Finding ledger

`pullRequest.reviewFindings` is `{ recorded, findings }`. It is the persisted inventory of everything any reviewer has reported on this PR, across attempts, heads, and bases. It follows the same pattern as the assignment ledger: `recorded: false` blocks, because without the ledger nothing shows there are no unresolved findings.

Each entry has a `kind`, the `reviewer`, that reviewer's stable native `id`, the `attemptId` that first reported it, a durable `nativeRef`, and a `resolution` or `null`. Identity is the pair of reviewer and ID: the same ID under another reviewer is a different entry, and a repeated pair blocks as ambiguous. There is no severity field. Every entry blocks.

An `adverse-review` entry records a reported negative verdict whose details were not available. The collector creates it so the verdict survives the attempt. A reviewer that failed to run (`state: "failed"`, `verdict: "unknown"`) reported no verdict and gets no entry.

### Resolution

An entry stops blocking only through one of two explicit resolutions. A timeout, a new push, an entry's attempt leaving the snapshot, and another reviewer's clean result resolve nothing.

| Kind | Accepted when |
| --- | --- |
| `native` | The entry's reviewer is a configured hosted reviewer, and the resolution's `provenance` matches that reviewer's policy issuer. This is provider-native resolution a trusted collector observed, such as a resolved review thread. It is not bound to a revision. |
| `follow-up-review` | All of these hold. Its `subject` is the exact repository, PR, head, and base under evaluation. Its `attemptId` names exactly one attempt in the snapshot, which is not the attempt that reported the entry. That attempt is a [credible review](#the-gate) with a `passed` or `failed` verdict and known findings, and does not itself still report the entry. The resolution's `provenance` matches the follow-up reviewer's policy issuer. |

A follow-up resolution carries an explicit `disposition`, `fixed` or `dismissed`, attested by the collector for that one entry. Both evaluate the same way, because either needs an independent complete review of the current revision. A follow-up may resolve one entry while reporting another; the new one blocks. A later push makes a follow-up resolution stale and the entry blocks again until a review of the new revision addresses it.

A follow-up resolution applies to any entry. A hosted reviewer's entry resolved only this way still leaves its review thread counted in `unresolvedThreads`, which the mergeability gate keeps blocking.

Ranger does not emit a follow-up resolution today. Until a producer supplies one, a local reviewer's finding stays blocked. There is no human or author path to resolve an entry.

### The gate

An attempt is a **credible review** when its reviewer and rung match a policy entry, its subject is the exact revision, its issuer matches policy, its state is `completed`, `complete` is true, `context` is `none`, and it has a `nativeRef`. A local attempt must also name instructions on the policy list. A hosted attempt's `deadlineAt` must equal `startedAt` plus the configured `waitSeconds`.

The gate passes when both hold:

1. At least one credible review has verdict `passed`, known `findingIds`, and every entry it reported resolved.
2. The ledger is recorded and has no unresolved entry, every finding an attempt reports is in the ledger, and attempt IDs are unique.

Nothing else is required. A configured reviewer that never started is not missing evidence. An attempt that is pending, unavailable, failed, or canceled never satisfies and never blocks on its own, so a pending attempt beside a clean review does not hold the change. Its findings, once in the ledger, do.

### Ladder exhaustion

`pullRequest.reviewLadder` is `null` or the ladder runner's claim `{ subject, provenance, exhausted }`. It never changes whether the gate passes. When no attempt satisfies the gate, an `exhausted` claim that is bound to the exact revision, comes from the policy's `ladder` issuer, and stands beside no pending attempt, no deadline mismatch, and no collection problem (including an unrecorded, ambiguous, or incomplete finding ledger) turns the failure into the distinct `needs_human` result. A claim that fails one of those tests leaves the result `blocked`, with the reason. That reason names what is missing; it is not authority to replay collection or a review, which the caller must bound and reconcile itself.

The claim is diagnostic. Forge does not prove from it that every rung ran.

`needs_human` is the wire value in this schema version. It means the ladder is exhausted and the change needs a disposition from outside the ladder. It does not mean that only a human can act, and it is not an escalation to the project owner: who receives it is the caller's routing policy, which Forge's evaluator does not decide. Routing it is not passing it. The result resets no attempt budget, authorizes no further dispatch, and bypasses nothing; the gate stays failed until acceptable evidence exists.

An exhausted ladder is blocked, not passed. An approval in the `human-review` gate does not satisfy it: this gate does not read human reviews, and no override exists. Whether a distinct override should exist is undecided and deliberately not implemented.

### Result

A version 2 result has `schemaVersion: 2` and `agentReview`, one entry per evaluated PR in input order:

| Field | Meaning |
| --- | --- |
| `pullRequest` | The PR number. |
| `disposition` | `satisfied`, `blocked`, or `needs_human`. `needs_human` is the accepted exhaustion case above, and is a failed gate. |
| `satisfiedBy` | IDs of the attempts that meet requirement 1. Look one up in the input snapshot to see its reviewer and `launch`. |

The `agent-review` gate conclusion stays authoritative; a disposition explains one PR's review evidence. Unresolved-finding reasons remain in the gate under `needs_human`. New reason codes are `findings-unknown`, `reviewer-not-acceptable`, `review-unavailable`, `review-pending`, `review-not-independent`, `instructions-untrusted`, `deadline-mismatch`, and `ladder-exhausted`. When no attempt satisfies the gate, the reasons also say why each presented attempt fell short.

```sh
bun run evaluate examples/evidence/v2/passing-pr.json --policy examples/evidence/v2/policy.json
bun run evaluate examples/evidence/v2/needs-human-pr.json --policy examples/evidence/v2/policy.json
```

The first exits `0`: the hosted reviewer timed out and a local review is clean. The second exits `1` with disposition `needs_human`. `examples/evidence/v2/blocked-pr.json` exits `1` because a clean local review does not clear the hosted reviewer's unresolved finding.

### What version 2 does not establish

Every comparison above checks a claim against policy. `context`, `launch`, `instructions`, `model`, `harness`, and the timestamps are attested by whoever issued the receipt; the evaluator proves none of them from JSON. `launch` does not mark a receipt as trusted: a separately invoked reviewer can emit untrusted claims too. A receipt from an author-spawned sub-agent is produced by the author's session. Policy accepts it today, and the result names which attempt satisfied the gate so a reader can see that.

`recorded: true` is the trusted collector's attestation that the ledger is complete. It is not self-proving, and the evaluator cannot detect a finding the collector never recorded. `unavailable` means unavailable at that snapshot, not that no report will arrive later.

## Trusted collector responsibilities

**Shape validation is not producer authentication.** A well-formed forged JSON document can reproduce every expected identity and fingerprint. The evaluator cannot distinguish that forgery from authentic normalized evidence. Its comparisons only establish consistency with supplied policy.

Before normalization, the trusted collector must authenticate the actual producer, validate repository and original source binding, select the latest authoritative run with complete pagination and cancellation state, and preserve runtime identity. Adding current SHAs to an unbound provider response does not establish its revision. A green Devin check without validated findings data cannot become a clean review. Keep proposed code away from trusted orchestration, policy, and privileged credentials; use a trusted revision outside the proposed checkout.

Human assignment history must persist after GitHub removes a request on review submission. Expand team requests into an explicit supported human requirement, or leave the requirement unsatisfied. Supply the effective decision, retaining an earlier approval across comment-only reviews and applying subsequent dismissal or changes requested in submission-time order. Do not select approvals by creation ID alone. Voluntary outstanding objections remain blocking after a push/base change and even when their original source binding is unavailable. An assigned reviewer needs a fresh exact-head/base approval; dismissal satisfies no assigned approval requirement.

GitHub approvals do not expose their original base. The pilot establishes that binding through prior stable, timestamped observations; this evaluator assumes collection has established equivalent trustworthy evidence. An unobserved or ambiguous approval base must remain unbound (`subject: null`) and cannot pass for an assigned reviewer. The evaluator does not reconstruct assignment history, review chronology, historical bases, actor authority, or ledger integrity.

For version 2 the collector must also establish each receipt's issuer and runtime outside proposed code, and must not relabel an unobservable `context` or `launch` as known. A collector cannot observe a hosted reviewer's independence, so its context stays `unknown` unless trusted collector policy explicitly attests that independence for the named reviewer. Under that exception the collector records `context: "none"` because the attestation says so and for no other reason. Eligibility in the evaluator's reviewer list alone supplies no attestation. Each attestation records its repository scope, basis and known weaknesses in [hosted reviewer attestations](hosted-reviewer-attestations.md). A hosted reviewer without an applicable adopted attestation stays `unknown`. The collector retains the attestation identifier and trusted policy revision alongside its observations and normalized result, because the version 2 evaluator cannot distinguish an attested `none` from observed clean context.

The collector persists the finding ledger for the life of the PR and adds every reported finding and every detail-less negative verdict to it. It records a resolution only from provider-native state it observed or from a follow-up review's explicit per-finding disposition. It preserves each attempt's `startedAt` across snapshots. It takes a fresh snapshot before a consequential action, so findings that arrived after a deadline are in the ledger; a timeout never erases them. For hosted reviewers that report through review threads, a finding is the thread and its native resolution is the thread being resolved, as in the pilot. A green provider status establishes neither completeness nor a clean result.

`mergeAuthorized` must come from an explicit trusted authorization rule for the repository and actor, with the referenced collection retaining its supporting evidence. [`collectPullRequest`](pull-request-collection.md#evidence) supplies the part of such a rule that GitHub shows, namely that the head branch is in the base repository and the pull request does not carry the hold label the trusted caller named; it reads no actor and no task scope, so the trusted caller stays responsible for the rest of the rule, including whether the repository adopts it. A label never grants authorization; the hold label only withholds it. That operation's evidence carries the decision and not the labels or repository IDs behind it, so retaining those stays with its caller. Collect authoritative candidate membership and current member revisions independently of stored admissions. Recollect mutable PR/queue state before a consequential action; hosted queue/ruleset enforcement remains necessary after the collection window.

## Source and deliberate adaptations

The behavioral baseline is pilot revision [`5264279b9ce776d2a8f8e6c3785c663d9b653cf8`](https://github.com/outfitter-dev/agentic-ci-pilot/commit/5264279b9ce776d2a8f8e6c3785c663d9b653cf8): `machinery/gates.py`, its 24 tests in `tests/test_gates.py`, and `docs/gate-contract.md`. Preparation found local pilot HEAD `897810f03bc14098809c5a113472649923d0d905` on the pre-squash implementation branch. All three requested files have identical blob IDs at that HEAD and the qualified baseline. The evaluator blob is `50e2e0d36c6611d6a0e641d09f883f17d64bfba5`; tests are `e7cd69338e11565e7e8345f7c81cce06bb9b47af`; contract is `c9834c74410dac27dad37a66d43a1d87d08cb4c2`.

Forge preserves the pilot's PR/candidate/member gate meanings and carries provenance checks from the pilot's surrounding `machinery/merge_queue.py` and `machinery/host_worker.py` source into explicit input. Deliberate adaptations are:

- A versioned, strict typed shape with arrays for reviews so duplicate observations remain visible. Unknown fields are rejected rather than silently accepted; missing observations and malformed containers remain distinguishable.
- Explicit repository, subject kind/PR ID, producer, run ID, and expected runtime/configuration fingerprints. Explicit `complete` is required for agent review, carrying forward the pilot cache's completion requirement.
- Current member revisions are supplied separately from saved admissions. Missing membership blocks review conclusions, as well as landing, rather than displaying successful empty aggregates.
- Collectors must exclude unrelated status contexts, including the evaluator's own mergeability status. The pilot ignored extra contexts; this contract rejects unsupported check names. No recursive gate dependency exists.
- Model claims use the small advisory shape above rather than round-tripping arbitrary provider output. No model verdict overrides or independently vetoes policy.

Part of collection now exists, as separate operations outside the evaluator. The GitHub response parsers in [parse-github-pull-request.ts](../src/parse-github-pull-request.ts) read pull request, review, timeline and review-thread responses into typed observations. `humanReviewEvidence` in [human-review-evidence.ts](../src/human-review-evidence.ts) turns those and a review ledger entry into assignment and human-review evidence. [`collectPullRequest`](pull-request-collection.md) assembles the pull-request part of the facts from injected reads. [`githubPullRequestReads`](pull-request-collection.md#github-read-transport) supplies those reads from GitHub's API, with a token and a `fetch` its caller passes. The [review ledger store](review-ledger-store.md) keeps the review ledger entry in a file between collections and replaces it only if it is still the entry the collection read; it does not authenticate who wrote the file. [`normalizeCheckReceipts`](verification-evidence.md) derives verification evidence from `forge check` receipts. [`forge gate`](forge-gate.md) is the command that composes these for one pull request: it reads a token from the environment, runs a collection, stores the ledger, joins the receipts and agent-review evidence it is given as files, and calls this evaluator. It reports the result and enforces nothing; it cannot verify where its policy, receipts or review evidence came from, and no live read is qualified. No queue discovery, finding-ledger or admission store, cache, or pilot JSON compatibility adapter is implemented. These omissions do not permit unsupported facts to pass; the caller must supply the required normalized facts or receive blocked/invalid results.

## Offline qualification

Run `bun test tests/evaluate-evidence.test.ts tests/merge-group-evidence.test.ts tests/validate-evidence.test.ts tests/agent-review-gate.test.ts tests/agent-review-validation.test.ts` for the operation, then `bun run check` for all repository checks. [Fixture builders](../tests/evidence-fixtures.ts) produce complete passing PR and merge-group inputs with fictitious identities; the tests mutate them into blocked and malformed cases. For example, changing the PR test receipt's state to `failed` blocks its test gate and landing while retaining the other gate results. Removing a member admission blocks a candidate despite successful integration checks. The [version 2 builders](../tests/agent-review-fixtures.ts) add attempts, ledger entries, resolutions, and an exhaustion claim; their tests cover unavailable and unstarted reviewers, late and retained findings, each rejected resolution, wrong or stale revisions, untrusted provenance, and version mixing.

These fixtures prove deterministic behavior, input validation, provenance comparisons, and failure handling without credentials. They do not authenticate a producer, qualify live assigned-human approvals, validate Devin findings integration, qualify any reviewer or a Ranger ladder run, prove concurrent queue refresh, or deploy Forge. Those live gaps remain separate work (FOR-9/FOR-11 and integration qualification). Existing pilot and product consumers remain unchanged.
