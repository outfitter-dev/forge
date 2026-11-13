# Codex review evidence

`codexReviewEvidence(input)` turns stable collector observations into one hosted `AgentReviewAttempt` and an updated `ReviewFindingLedger` under the [approved Codex contract](hosted-reviewer-attestations.md#codex-hosted-code-review). The operation is pure. It returns detached data and uses no clock, filesystem, provider invocation or network. Its fixtures exercise the real version 2 evaluator.

## Input and caller responsibilities

The exported `CodexReviewEvidenceInput` carries the following inputs.

| Input | Meaning |
| --- | --- |
| `subject` | The exact repository, pull request, head and base from the accepted collection. |
| `servedAt` | The first pull request read’s whole-second UTC served time. |
| `snapshot` | The effective `ObservedRevision` produced by `nextSnapshot` using persisted history and the complete base-change timeline, or `null` when unavailable. |
| `summary` | The `CodexSummaryObservation` from the strict [summary parser](codex-summary-observations.md), after stable complete comment collection. |
| `threads` | The full stable review-thread list, including resolved threads and earlier heads. |
| `findings` | The previously accepted `ReviewFindingLedger`, including other reviewers’ entries. |
| `findingsComplete` | Optional explicit caller attestation that every reporting source it owns was fully collected and accepted prior findings retained. Absent or false produces `recorded: false`. |
| `reviewer` | The configured hosted reviewer policy, including issuer identity, runtime fingerprint and positive wait. |
| `issuer` | The collection’s provenance for that reviewer, matching its configured producer and runtime. |
| `botAccountId` | The configured positive numeric bot account ID. Thread attribution also requires `Bot` type. |
| `attestation` | Explicit independence metadata with `id`, `policyRevision`, repository, reviewer and bot account ID, or `null`. |

The caller authenticates sources, supplies complete pagination, establishes two-pass stability and selects policy from outside the proposed checkout. A matching old head/base snapshot alone cannot establish binding when an intervening base event invalidated it. The caller passes the effective snapshot from human-review collection after the whole timeline was read. This also preserves the snapshot’s start across repeated collections of the same valid revision.

The caller must persist returned findings atomically with the snapshot and human bindings before using the returned attempt. It retains the returned observation record alongside normalized evidence. Existing stored entries and the pure operation cannot authenticate the attestation or prove that the caller collected every configured source. A true completeness claim can upgrade unknown history only through that explicit trusted caller responsibility.

Malformed subjects, timestamps, issuer configuration, duplicate thread IDs and corrupted finding input throw `InvalidEvidenceError` with fixed field paths and expectations. Finding-validation errors are sanitized. A snapshot later than the served time is invalid input. Missing or mismatched snapshots produce unavailable attempts.

## Binding and attempt window

A summary can establish a current completed review only when its parsed code-review commit equals the current head, the snapshot matches the current head and base, and the summary’s `updatedAt` is strictly after the snapshot and no later than `servedAt`. A first collection’s new snapshot is at `servedAt`, so an already completed summary cannot bind until a later bot update. This preserves the accepted retrigger consequence.

`startedAt` is the effective snapshot’s `observedAt`. With no snapshot, the unavailable attempt uses `servedAt` as its start and establishes no persisted observation window. `observedAt` is `servedAt`, and `deadlineAt` is the stable start plus the reviewer’s configured wait. Repeated polls retain the start and deadline. Stale-head and noncompleted parsed reports are pending before the deadline and unavailable with reason `timeout` at or after it. A credible completed report may arrive after the deadline under the evaluator’s existing rules. Reported findings persist after every deadline.

The deterministic attempt ID hashes the reviewer and bot identity, explicit repository/PR/head/base fields, window start, issuer producer/runtime, configured wait and attestation identifier/policy revision. Poll time, provenance run ID, comment edits and object property order do not change it. Changed revision, effective window or trusted configuration changes its identity.

A completed bound clean candidate has `complete: true`, `state: "completed"`, `verdict: "passed"` and known finding IDs. A completed bound report with adverse flags or an unresolved attributed thread has a failed verdict and references recorded findings. Unavailable or stale reports preserve their original parsed commit in the observation record and cannot establish credible current completion.

The approved inactive all-null security section is compatible with a clean code review. An active clean-looking security section remains unsupported for passing evidence. Active adverse flags are retained. `model`, `harness` and `instructions` remain `null`, and `launch` is `unknown`. `context` is `none` only when the explicit attestation matches repository, reviewer and bot identity. Otherwise it is `unknown` and the evaluator cannot accept the attempt as independent.

## Findings and resolution

Every attributed thread becomes a finding keyed by its stable GraphQL node ID. The node ID itself is its durable native reference. Existing kind, reviewer, ID, first reporting attempt and native reference remain intact. A currently resolved thread supplies a native resolution with the configured issuer’s provenance. An explicitly reopened thread restores a null resolution. When a thread disappears or its author becomes unknown, a previously native-resolved entry becomes unresolved. Disappeared explicit follow-up dispositions and other reviewers’ entries are preserved. The evaluator continues to decide whether any retained resolution is credible under current policy.

A positive adverse report without safely attributable details creates a synthetic `adverse-review` entry keyed by the stable comment database ID. Its native reference is that comment’s source URL. This fallback also covers unresolved flags with only resolved visible threads, and unavailable or malformed adverse observations whose flags cannot safely map to thread details. Stale reports and reports with an unverified editor still retain these adverse observations from the strict parser. An ordinary valid report with findings and no unresolved flag may use its visible resolved threads.

Adverse sources are accounted for individually. A separate adverse bot comment retains its own synthetic blocker even when the governing summary is parsed and visible threads are resolved. Attributable resolved findings from the governing summary keep their native resolutions.

Synthetic entries persist across subsequent clean reports and have no provider-native exit. This conservative fallback can keep a change blocked after a provider loses or obscures details. The accepted contract requires retaining that uncertainty. Another reviewer’s clean result resolves nothing by itself.

A clean summary contradicted by an unresolved attributed thread produces completed failed evidence and `summary-thread-conflict`. The diagnostic gives the lead the evidence required to apply the contract’s attestation-withdrawal rule. The pure operation changes no policy.

## Result and next integration

The exported `CodexReviewEvidenceResult` has `agentReviews` containing exactly one attempt, `reviewFindings`, `reviewLadder: null`, fixed-code `diagnostics` and `observations`. The observation record retains explicit attestation metadata, the effective snapshot, parsed summary state/flags, summary and adverse-comment identities/native references/author/editor/timestamps, and normalized thread observations. It strips comment bodies.

Collection integration must read comments before the first pull request response, compare complete normalized comments on the second pass, use the first served time and effective snapshot, and persist returned findings in the accepted CAS. It must distinguish absent review-evidence input from an explicitly supplied unknown history when combining sources. Policy adoption, the live observation and the guidance-revision experiment remain separate prerequisites. The operation emits no ladder exhaustion claim.
