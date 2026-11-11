# Worker lifecycle and capacity plan

November 11 clarification: execution host is explicit configuration. Studio was one established pilot host; it is not the permanent or sole Buildkite host. Historical operational details below are preserved pending verified private archival under [FOR-25](public-readiness.md#operational-record-preservation). This preparation changes no host, service, state, capacity or lifecycle implementation.

FOR-8 originally delivered this plan without operational inspection or changes. A later Matt-authorized read-only inspection is recorded in the [established pilot setup](handoff.md#established-pilot-setup): the Studio/operator and Rex topology are established, with dated container limits and process availability. Reuse this setup where suitable; do not ask Matt to reselect the host or recreate workers. The [session closeout](session-closeout.md) and [pilot qualification](pilot-qualification.md), at pilot source `5264279b9ce776d2a8f8e6c3785c663d9b653cf8`, remain historical evidence. Current setup does not authorize relocation, restart, renewal, services or more concurrency, and time-sensitive status must be rechecked before an authorized operation.

## Ownership and decisions before operation

| Responsibility | Recorded baseline and proposed accountable owner | Decision still needed |
| --- | --- | --- |
| Host and pilot operation | The dated pilot used Matt’s Studio and existing Rex workers; other hosts can be explicitly configured. Matt operated that pilot. | Select the configured host/operator for each released operation, name a backup, and recheck process identity/availability; this does not require repeatedly selecting the established pilot host. |
| Trusted automation runtime | Forge owns gate/collection behavior and runtime release definitions. Product repos own the commands under evaluation. | Name the person allowed to approve/install a pinned runtime release and its rollback. No installer or service is supplied here. |
| Registration and service access | Existing Buildkite/GitHub/model access belongs to its current account owners; reuse grants no new authority. | Confirm service account, repository/queue scopes, allowed actors, and credential custodian before implementation. |
| Token renewal | Propose the accepted operator as renewal DRI, with a named backup. The historical registration token had a seven-day lifetime. | Custodian must record actual expiry privately, arrange advance reminders, renew under explicit authority, and confirm old-token revocation/overlap policy. No expiry or validity was checked here. |
| Persistent evidence and deletion | The operator must preserve review cache, PR admissions, and human-observation ledger; Forge defines their validity rules. | Accept backup/restore, retention, reader, deletion, and incident-response ownership before moving state. |
| Agent behavior/history | Ranger owns its harness and history contract; it is not required to make this lifecycle plan. | Any later Ranger history/storage selection belongs to [FOR-15](https://linear.app/outfitter/issue/FOR-15), with its own access and retention decisions. Do not pre-create a shared store. |

Existing host/operator ownership is established; the remaining proposed future responsibilities grant no new permissions. Planning can complete with those choices recorded; installing, renewing, moving, starting, or increasing capacity still requires the relevant operational scope.

## Historical locations and preserved evidence

All baseline paths below are relative to `/Users/mg/Documents/Codex/2026-11-10/i/`. They are recovery pointers from the closeout, not locations validated by this task. No secret file contents were read.

| Recorded location | Role and preservation requirement |
| --- | --- |
| `work/agentic-ci-pilot` | Source checkout, `infra/` and runtime documentation. Proposed checkouts must not supply privileged orchestration. |
| `work/native-agent/runtime` | Installed trusted runtime outside proposed checkout cleanup. Retain its exact source/configuration/executable identity for rollback. |
| `work/native-agent/run-in-rex.sh`, `agent.pid` | Historical launcher/PID pointer. A PID file alone is not permission or sufficient process identity for signaling. |
| `work/native-agent/state` | Review cache, admissions, and human observation/assignment state. Preserve together with schema/runtime provenance; never silently grandfather stale evidence. |
| `work/native-agent/builds`, `agent.log` | Checkout area and historical log. Active logs moved to Rex in the recorded run; neither path proves present activity. |
| `work/pilot-secrets/buildkite-agent-token` | Historical private registration-token location, outside source control and proposed checkouts. It is a location reference only. |
| `outputs/final-release-receipt.json` and private release ZIP | Source/digest-bound qualification artifacts; retain as historical evidence, not current admissions. |

The historical Linux worker used Docker Compose project `outfitter-ci-pilot` and a persistent build volume. The later handoff inspection confirms the existing container, limits, mounts and persistent volume at its recorded time; recheck mutable facts before operation rather than treating the setup as unselected. Model login, token validity and expiry were not inspected. Do not enumerate or copy account credential stores during planning, or infer Devin API access from worker registration.

## Proposed stable placement

For a later permanent relocation, select an operator-owned root outside repositories, worktrees, and cleanup-managed job directories. Candidate on the established Studio under `mg`: `~/Library/Application Support/Forge/workers/<pilot-name>/`; the new root remains a future implementation decision, not a prerequisite for reusing the existing setup. Do not create this tree as part of FOR-8.

- `runtime-releases/<revision>-<fingerprint>/`: immutable reviewed code/configuration plus a manifest of source, policy, task/model/harness/prompt configuration, and actual executable identity. Launch resolves one approved release; a job cannot replace it from proposed code. Keep the previous known-good release available.
- `state/<repository>/`: persistent admission, review-cache, and human-ledger data with source/runtime/schema provenance. Use existing locking/atomic-write semantics; permit one writer per state namespace. Job cleanup must never remove this directory.
- `builds/<repository>/<role>/<slot>/`: disposable job workspaces, separated from runtime/state. A later extra slot must earn its own checkout and writer namespace; adding a Rex pane is not isolation.
- `logs/` and `evidence/`: bounded, access-controlled operator diagnostics/receipts outside Git. Decide retention and redaction before implementation; do not collect transcripts merely for convenience.

Keep secrets separate from this movable runtime/state tree, outside proposed checkouts and their mounted views. Preserve the existing private token path until its custodian selects another protected store. Proposed host controls include owner-only directory/file access and minimal service scopes, but no permissions have been changed or verified here. A runtime release must reference credential delivery by role, not embed values in its manifest. A backup must not accidentally include the secret store.

Native review remains trusted text-only work; it must not execute proposal code. Verification retains its unprivileged container boundary, no host-home or Docker-socket mount, and no model/GitHub/Buildkite credentials in the proposal execution environment. The agent process may need registration authority; that does not authorize passing it to product commands. Same-account native execution still shares the operator's account and provider quota; choosing a stable directory does not create a sandbox.

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

Rex remains the proposed operator surface because Matt requested session `remotes`, tab `buildkite-workers`, two equal side-by-side panes: native review left and container verification right. Preserve that arrangement if retained; re-resolve actual pane/process IDs under operational authorization. The plan does not select a permanent native service manager or install a daemon. If unattended service management is later chosen, retain equivalent visibility and graceful drain/rollback; approve that choice separately instead of assuming a four-hour foreground pilot is permanent infrastructure.

## Resource boundaries and evidence before concurrency

The closeout records one native review job and one verification job. The Linux container was limited to two CPU equivalents, 2 GiB memory, and 256 processes, with unprivileged UID 1001 and a persistent build volume. Native review used nice level 10 and a four-hour maximum process lifetime; Compose used `restart: unless-stopped`. These are historical settings, not measurements of present load, available capacity, or validated sustained throughput.

Native nice priority is a scheduler preference. It is not a CPU ceiling, memory cap, account boundary, or desktop-load throttle. Rex is visibility/control, not resource enforcement. The recorded pilot has no established native memory cap, automatic desktop-activity throttle, unattended refresh guarantee, or safe multi-slot namespace. The plan therefore keeps the default ceiling at the historical one review plus one verification job until separately authorized measurement and qualification justify a change.

Before any concurrency increase, an accepted operator must collect dated evidence at the existing single-slot settings: host CPU/RSS/memory pressure, container CPU/memory/process peaks and OOM events, job durations and queue delay, desktop responsiveness under representative interactive load, provider latency/rate limits/quota, disk use, and cancellation/shutdown behavior. Record exact runtime/configuration, fixture size, task mix, and observation window so the result is reproducible. A successful release artifact or a short passing build is not a capacity measurement.

Approve host headroom, maximum native memory, acceptable interactive latency and queue/duration thresholds before the experiment; this plan invents no measured budget or healthy threshold. Prove disjoint checkout/state handling, exclusive ledger writes, stable producer/revision binding, and credential separation for each proposed slot. Only then may an explicitly approved disposable two-slot trial test those thresholds. Exceeding budgets, OOM, context loss, credential exposure, ambiguous evidence, or writer collisions fails the trial; restore the last qualified single-slot configuration and preserve evidence. More queued work alone does not authorize more slots.

## Bounded validation and implementation follow-up

Proposed first follow-up is a focused worker-lifecycle implementation/qualification task, with the operating owner, host/root, retention/restore policy, and credential custodian selected first. Do not create a deployment issue or execute a test as an incidental action of this plan. Its scope should be:

1. Build a disposable runtime/state fixture outside real worker state. Without services or credentials, test immutable release selection, job-cleanup exclusions, exclusive writers, schema compatibility refusal, deliberate interrupted update, and verified rollback. Preserve the real pilot directories untouched.
2. After separate operational authorization, use a named disposable consumer/queue with at most one verification and one review job. Run one passing fixture and one deterministic failure, then one controlled drain/restart and a simulated unavailable/expired credential path that must not produce passing evidence. A real inference call, token renewal, repository creation, or queue/ruleset mutation requires its own explicit permitted operations; do not infer it from this test outline.
3. Compare pre/post runtime and preserved-state inventories, assert no dual writers or leaked privileged environment, and verify fresh head/base/runtime-bound results. Record recovery time and resource observations. Stop the disposable trial, restore the selected prior launcher/runtime/queue configuration, and leave real state intact. No concurrency increase belongs in this first trial.

Acceptance evidence must include source/runtime/configuration fingerprints, dated host/enforcement/namespace facts, non-secret job/receipt references, negative and rollback results, preservation digests, operator signoff, and residual limits. Only an accepted result may support replacing temporary launchers; planning completion itself provides no installation authority. [FOR-15](https://linear.app/outfitter/issue/FOR-15) can consume these lifecycle decisions if its chosen Ranger integration environment actually needs them; FOR-8 does not hard-block it or resolve Ranger history, cross-owner distribution (FOR-6), provider findings (FOR-9), or concurrent queue refresh (FOR-11).
