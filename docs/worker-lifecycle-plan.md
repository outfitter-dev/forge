# Worker lifecycle and capacity plan

FOR-8 delivered a lifecycle plan and is reopened for configurable hosts and trusted/project execution lanes. The complete original machine-specific plan is preserved in the [local operational archive](public-readiness.md#operational-record-preservation); Matt accepted machine-local, non-durable storage. Routine scoped delivery follows [standing authority](../AGENTS.md#standing-delivery-authority), with non-passes routed through [owned recovery](../AGENTS.md#owned-failure-recovery). No worker, service, state, credential or capacity change is performed by this documentation move.

Execution host is explicit configuration. Studio was one historical pilot host, not a permanent or sole Buildkite host. An operator must identify the actual host/account, queues, trusted runtime, isolated project-code lane and allowed inputs for an agreed operation. Prior setup observations are not current health or access evidence.

## Ownership and preservation

| Responsibility | Required ownership/configuration |
| --- | --- |
| Host and operation | Configure the host/operator and backup; reverify process/executable identity and active work before changing it. |
| Trusted runtime | Forge owns gate/collection behavior and release definitions; the operator selects a reviewed immutable runtime/configuration and known-good rollback. Products own commands and task graphs. |
| Service access and renewal | Credential custodians own scopes, protected delivery, actual expiry, renewal/overlap and revocation. Preserve access boundaries; no values or secret-store locations belong in public source. |
| Persistent evidence | Preserve review cache, admissions and human-observation state with schema/runtime provenance. Assign retention, consistent backup/restore and deletion ownership before moving state. |
| Agent behavior/history | Ranger owns its harness, history and recovery loop; Forge does not pre-create a shared store or agent loop. |

## Placement boundaries

Keep trusted runtime releases, persistent state, disposable job checkouts and bounded operator evidence in separate namespaces outside proposed checkout cleanup. An adopted runtime manifest binds reviewed source, policy/configuration and executable identity; a job cannot replace it with proposal code. Each extra slot needs disjoint workspaces and exclusive state-writer ownership. Adding a terminal pane supplies neither isolation nor concurrency safety.

Keep secrets outside both the movable runtime/state tree and proposal mounts. Reference delivery by role, never embed values or include the secret store in a backup. Native trusted review consumes text and must not execute proposals. Project commands run unprivileged without privileged orchestration credentials, host-home access or a Docker socket. Directory placement and same-account execution alone are not a sandbox. Concrete enforcement and namespace facts must be qualified on the configured host.

## Lifecycle contract for a later implementation

| Phase | Required behavior and evidence |
| --- | --- |
| Preflight | Under explicit operational authorization, establish host/account, actual process and executable identity, trusted revision/configuration, active jobs, queue/role tags, state locks, mounts/volumes, resource limits, token expiry, and access boundaries. Record a dated non-secret snapshot. Stop if identity or ownership is ambiguous. |
| Preserve | Drain writers before a consistent state snapshot. Record file inventory/digests and schema/runtime identity privately; prove backup exclusions and restore readability. Preserve original state and runtime until acceptance/retention decisions permit deletion. A copy made during active writes is not a proven recovery point. |
| Launch | Start the selected pinned runtime in its own namespace after owner preflight. Keep verification and review at one job each initially. Verify role/queue identity, limits, no competing ledger writer, evidence binding, and bounded uptime/exit behavior. Unavailable authentication or missing context must leave evidence pending/blocked. |
| Drain and stop | Disable new admission/dispatch through the chosen service mechanism, observe active work, and use the authorized graceful-stop path. Apply a bounded escalation policy only to reverified owned processes. Stop/restart is not accomplished by closing a chat or switching Rex tabs. Preserve state and volumes. |
| Update | Stage a new trusted release beside the old one; review the code/config diff and fingerprint changes. Validate against disposable copied state before promotion. Drain the old writer, select the new release, and verify no overlap before resuming work. Changed relevant runtime/configuration invalidates old review/admission reuse; do not rewrite old receipts as fresh. |
| Roll back | Drain the new writer, select the prior known-good release, and restore only a compatible, verified snapshot in a separate state location if necessary. Confirm source/runtime/schema bindings and require fresh evidence when assumptions changed. Do not blindly run an old reader against upgraded state or erase newer audit records. If compatibility is unknown, stay stopped/blocked and recover with the owner. |
| Retire | Only after evidence retention and recovery acceptance, stop owned processes, revoke unused registration/access under custodian authority, and remove approved disposable workspaces. Persistent state, private evidence, old runtime releases, and volumes each need an explicit retention/deletion decision. |

The configured operator surface must retain visibility of trusted review and isolated verification, with current process identity and a graceful drain/rollback path. A terminal layout is not a scheduler or resource boundary. The historical pilot selected no permanent native service manager; this plan installs no service.

## Resource boundaries and evidence before concurrency

The historical pilot used one trusted review slot and one isolated verification slot. Concrete per-host limits, uptime and process observations are preserved in the local operational archive; they are not universal Forge defaults or measurements of current headroom. Verification must remain unprivileged and resource-bounded, with persistent state separate from disposable checkouts.

Native nice priority is a scheduler preference. It is not a CPU ceiling, memory cap, account boundary, or desktop-load throttle. Rex is visibility/control, not resource enforcement. The recorded pilot has no established native memory cap, automatic desktop-activity throttle, unattended refresh guarantee, or safe multi-slot namespace. The plan therefore keeps the default ceiling at the historical one review plus one verification job until separately authorized measurement and qualification justify a change.

Before any concurrency increase, an accepted operator must collect dated evidence at the existing single-slot settings: host CPU/RSS/memory pressure, container CPU/memory/process peaks and OOM events, job durations and queue delay, desktop responsiveness under representative interactive load, provider latency/rate limits/quota, disk use, and cancellation/shutdown behavior. Record exact runtime/configuration, fixture size, task mix, and observation window so the result is reproducible. A successful release artifact or a short passing build is not a capacity measurement.

Approve host headroom, maximum native memory, acceptable interactive latency and queue/duration thresholds before the experiment; this plan invents no measured budget or healthy threshold. Prove disjoint checkout/state handling, exclusive ledger writes, stable producer/revision binding, and credential separation for each proposed slot. Only then may an explicitly approved disposable two-slot trial test those thresholds. Exceeding budgets, OOM, context loss, credential exposure, ambiguous evidence, or writer collisions fails the trial; restore the last qualified single-slot configuration and preserve evidence. More queued work alone does not authorize more slots.

## Bounded validation and implementation follow-up

Proposed first follow-up is a focused worker-lifecycle implementation/qualification task, with the operating owner, host/root, retention/restore policy, and credential custodian selected first. Do not create a deployment issue or execute a test as an incidental action of this plan. Its scope should be:

1. Build a disposable runtime/state fixture outside real worker state. Without services or credentials, test immutable release selection, job-cleanup exclusions, exclusive writers, schema compatibility refusal, deliberate interrupted update, and verified rollback. Preserve the real pilot directories untouched.
2. After separate operational authorization, use a named disposable consumer/queue with at most one verification and one review job. Run one passing fixture and one deterministic failure, then one controlled drain/restart and a simulated unavailable/expired credential path that must not produce passing evidence. A real inference call, token renewal, repository creation, or queue/ruleset mutation requires its own explicit permitted operations; do not infer it from this test outline.
3. Compare pre/post runtime and preserved-state inventories, assert no dual writers or leaked privileged environment, and verify fresh head/base/runtime-bound results. Record recovery time and resource observations. Stop the disposable trial, restore the selected prior launcher/runtime/queue configuration, and leave real state intact. No concurrency increase belongs in this first trial.

Acceptance evidence must include source/runtime/configuration fingerprints, dated host/enforcement/namespace facts, non-secret job/receipt references, negative and rollback results, preservation digests, operator signoff, and residual limits. Only an accepted result may support replacing temporary launchers; planning completion itself provides no installation authority. [FOR-15](https://linear.app/outfitter/issue/FOR-15) can consume these lifecycle decisions if its chosen Ranger integration environment actually needs them; FOR-8 does not hard-block it or resolve Ranger history, cross-owner distribution (FOR-6), provider findings (FOR-9), or concurrent queue refresh (FOR-11).
