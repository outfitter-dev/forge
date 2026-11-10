# Bounded queue qualification

This November 10, 2026 record follows the [FOR-11 investigation](queue-refresh-investigation.md) and its offline admission-refresh tests. It distinguishes current live evidence from the historical pilot. FOR-11 remains incomplete until a supported two-PR candidate mapping and exact-revision refresh after main advances are demonstrated.

## Released scope and immutable fixtures

Matt authorized the existing private `outfitter-dev/agentic-ci-pilot` on the established Studio runtime, at most two harmless independent fixture PRs, initially eight, then explicitly nine total Buildkite builds / 27 verification jobs, four actual native Codex reviews, one native worker start, only one landing/base advancement, and a 60-minute window. Existing single verification/review slots, deterministic gates, preserved state and cleanup apply. No worker installation, runtime update, credential expansion, pipeline setting change or production migration was included.

The live window began at 22:52:05 UTC with deadline 23:52:05 UTC. Initial main was `5264279b9ce776d2a8f8e6c3785c663d9b653cf8`; no PR or queue entry was open. Read-only service inspection found the existing ALLGREEN queue, up to two speculative entries, required six pilot statuses tied to the Buildkite integration, and no bypass. PR open/update, label and ready-for-review triggers were enabled; duplicate branch skipping was disabled. Buildkite's merge-queue and destroyed-group cancellation settings were enabled. These are dated observations, not settings changed by the run.

An isolated fixture checkout preserved the original pilot source and installed trusted runtime. Both branches started from that exact main:

| Fixture | Head and intended behavior |
| --- | --- |
| First marker | `cfa41e2cf4e542606619c59d087fb4b43b21ad28`, a three-line marker file under `pilot/`. Offline lint and 204 tests passed. |
| Second integration guard | `b709e61b7a3e162acb152935396b0159beb5999c`, a deliberate test requiring that marker to be absent. Offline lint and 205 tests passed independently; the combined local tree failed exactly this guard, after which the temporary merge was aborted. |

The second candidate is deliberately ineligible after including the first marker. This enforces the one-landing limit through verification rather than a race to dequeue. It must not be repaired or waived to make the experiment green.

## Initial live observation

[Draft pilot PR #5](https://github.com/outfitter-dev/agentic-ci-pilot/pull/5) used the first head against the initial main. Even though `pilot:automerge` was preselected before submitting the GitHub form, opening and labeling emitted two builds: [#36](https://buildkite.com/outfitter/agentic-ci-pilot/builds/36) and [#37](https://buildkite.com/outfitter/agentic-ci-pilot/builds/37). Both count toward the cap. No feature-branch push build was observed under the configured `main gh-readonly-queue/*` filter.

Build #37 passed lint, test, build, agent review and human review; its mergeability receipt failed with `PR 5: draft is not False`, bound to the exact first head and initial base above. Draft state is an independent blocker despite passing other gates. No assigned-human scenario is claimed by the passing human gate.

The initial open/label duplication invalidated the original estimate. Matt explicitly increased the cap to nine total builds / 27 verification jobs without changing the other limits or deadline. A delayed [build #38](https://buildkite.com/outfitter/agentic-ci-pilot/builds/38/summary) then exposed another automatic source: its Summary identifies `Webhook (pull_request_review)`, matching Devin's submitted review. It was missed in the first count and added when reconciling the pipeline. Green provider status was not treated as absence of provider activity. The parent directed retaining the nine-build cap and closing out partial evidence rather than another expansion.

| Build | Fixture/event | Result |
| --- | --- | --- |
| [36](https://buildkite.com/outfitter/agentic-ci-pilot/builds/36) | PR #5 opened | Verification/review passed; draft mergeability failed. |
| [37](https://buildkite.com/outfitter/agentic-ci-pilot/builds/37) | PR #5 labeled | Same draft blocker. |
| [38](https://buildkite.com/outfitter/agentic-ci-pilot/builds/38) | PR #5 review submitted | Same draft blocker; observed `pull_request_review` webhook. |
| [39](https://buildkite.com/outfitter/agentic-ci-pilot/builds/39) | [PR #6](https://github.com/outfitter-dev/agentic-ci-pilot/pull/6) opened | Standalone verification/review passed; draft mergeability failed. |
| [40](https://buildkite.com/outfitter/agentic-ci-pilot/builds/40) | PR #6 labeled | Same draft blocker. |
| [41](https://buildkite.com/outfitter/agentic-ci-pilot/builds/41) | PR #5 ready for review | All six pilot gates passed; exact original head/base admission was saved. No enqueue followed. |
| [42](https://buildkite.com/outfitter/agentic-ci-pilot/builds/42) | PR #6 review submitted | Standalone verification/review passed; draft mergeability failed. |

Final totals are seven builds, 21 verification jobs and 21 native gate jobs, one worker start and zero landings. Native gate jobs are not synonymous with inference calls. Two new passing Codex model-result cache records were observed, one per fixture head, at the same original base and runtime fingerprint `faf618144a7f5b2a2068fa1c151b7bc04163ee5da82f7d70fbc3497bd5369904`. The inspected single-slot path consults this valid cache before inference and reuses the result across duplicate jobs. The two-inference accounting is derived from those records and that serial path; it is not an independent provider billing audit. No failed review or cache deletion was observed, and no fresh-base review was executed.

## Event-budget model for any future proposal

Budget emitted service work, including delayed bot-review webhooks, rather than user clicks. Under the observed configuration, each PR can cause opened, labeled, submitted-review and ready events: four baseline builds per PR. A two-PR attempt therefore needs at least eight baseline builds, two speculative candidate builds and the first landing's main build, or eleven builds / up to 33 verification jobs, before a refresh or replacement. This is a lower bound, not a new authorization or guaranteed ceiling: additional review submissions, reruns, label changes, candidate invalidation/recreation and cleanup events must be inventoried and reserved separately. An independently collected fresh base may consume another native inference review even if the PR head is unchanged.

A future packet must inspect the exact configured event set, account for asynchronous work already dispatched, define a reserve/stop point before enqueue can start consequential automatic work, and distinguish verification jobs, native gate jobs, inference calls and landings. Do not disable triggers, exclude duplicates, reuse stale evidence, or request a cap based solely on the minimum path. This run neither qualifies live two-entry mapping/cancellation nor proves advancing-main refresh; the offline evaluator regressions remain the evidence for stale-admission rejection.

## Runtime and cleanup

The native reviewer had already exited at its four-hour limit. One approved start reused its existing launcher, installed trusted runtime, state, account and one-slot configuration. The exited Rex block was preserved detached because it had no terminal restart operation; a replacement left pane retained the two-pane 50/50 arrangement beside the unchanged verification pane. Process status is time-sensitive; see the [established setup](handoff.md#established-pilot-setup), not an inference from a historical running process.

Both owned fixture PRs were closed without enqueueing, and their remote branches were removed after exact-head checks. At cleanup the queue and open-PR set were empty and main remained `5264279b9ce776d2a8f8e6c3785c663d9b653cf8`. All seven builds had finished; no cancellation or label-removal trigger was necessary. No further build was observed during closeout.

At 23:12:22 UTC the newly started native reviewer was confirmed idle with its expected process/pane identity, then received one graceful interrupt. It reported no running job, disconnected and exited 0 at 23:12:23 UTC, restoring its prior stopped availability before the original deadline. The replacement pane is `block:01a1c7a9-8252-7dbb-aebb-9dbf42e8ca95`; the original exited block remains preserved detached. Rex inspection confirmed the unchanged right verification pane and 50/50 split. The Linux container remained running with the same image; no worker state/cache/admission/human ledger or installed runtime was deleted or relocated. Sanitized result metadata and the isolated fixture checkout remain in private thread storage; no credential or transcript entered Git.

FOR-11 remains open. This baseline establishes automatic trigger cost, original-revision admission and a draft landing blocker. It does not justify a production refresh mechanism or claim the unexecuted two-entry/base-advance acceptance criteria.
