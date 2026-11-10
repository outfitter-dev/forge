# November 10 session closeout

This is the archive entry point for the session that built the self-hosted CI pilot and bootstrapped Ranger and Forge. Start here, then read [the implementation handoff](handoff.md), [the full pilot report](pilot-qualification.md), and [legacy Forge retirement](legacy-forge.md). The reports distinguish demonstrated behavior from proposed follow-up. Later repository changes take precedence over this historical snapshot.

## Settled direction

Matt selected Pi as the common agent harness, customized in private `outfitter-dev/ranger`, for local work and automated jobs. Ranger is broader than CI. The new private `outfitter-dev/forge` owns shared engineering automation for both `outfitter-dev` and personal `galligan` repositories: GitHub Actions, Buildkite, worker setup, local CI, and possible Dagger/Turbo integration. Product repositories retain their build graphs and actual commands. The earlier suggestion of a separate infrastructure repo or moving everything into `outfitter-dev/actions` was superseded by this Forge scope. Existing Actions consumers remain operational until explicitly migrated.

Both new repos started with current stable Bun 1.4.4 and TypeScript 7.0.2. Ranger pins Pi 1.5.2. Forge initially used Biome; another agent subsequently adopted Oxc/Ultracite on commit `f66875f`. Follow current package scripts and local guidance, not the original bootstrap tool list. Both repos remain private; cross-owner distribution is unresolved, not implicitly enabled.

## Completed and review state

- [Pilot PR 1](https://github.com/outfitter-dev/agentic-ci-pilot/pull/1), [PR 2](https://github.com/outfitter-dev/agentic-ci-pilot/pull/2), and [PR 3](https://github.com/outfitter-dev/agentic-ci-pilot/pull/3) landed through the actual GitHub merge queue. Final source: `5264279b9ce776d2a8f8e6c3785c663d9b653cf8`.
- The pilot proved separate gates, a passing lower stack layer landing while an upper layer failed, subsequent repair/requalification, and private release qualification. Its 204-test suite and live evidence are linked in the pilot report.
- [Ranger PR 1](https://github.com/outfitter-dev/ranger/pull/1) is merged as checked during closeout. Its repo handoff records Pi research and the recommended first implementation slice. Do not assume a production harness has been implemented merely because the bootstrap merged.
- [Forge PR 1](https://github.com/outfitter-dev/forge/pull/1) is still open as checked during closeout; its original scaffold CI passed. Another agent has added tooling changes. This closeout is isolated from that agent's working tree and does not claim to validate subsequent work.
- Forge's local `docs/decision-scratchpad.md` was untracked during closeout. It belongs to ongoing work; it was not overwritten, staged, or included here. This document preserves this session's decisions, not another agent's unfinished deliberations.

## Pilot operation and recovery pointers

The Studio runs a Linux verification container and a native Mac reviewer. Buildkite registration uses outbound connections; GitHub events create builds, a trusted bootstrap generates steps, and queue/role tags select workers. There is no inbound SSH dispatch or GitHub Actions relay. Queue `pilot-self-hosted`, roles `verify` and `review`. Both launchers currently use one slot. More jobs queue; more worker slots do not require more Rex tabs.

Rex session `remotes`, tab `buildkite-workers`, two equal panes. Review is on the left and Docker Compose control/logs on the right. Preserve this arrangement; Matt specifically requested it instead of separate tabs. Session ID: `session:01a1b1de-3fa7-77c4-ab78-9350e6391db0`. Review block: `block:01a1c692-7c28-78ca-9792-a815cc7a794e`; verification block: `block:01a1c692-a431-7153-9012-d34a9577a310`. Reinspect IDs and live state before operating them.

All temporary pilot paths below are under `/Users/mg/Documents/Codex/2026-11-10/i/`:

| Path | Purpose |
| --- | --- |
| `work/agentic-ci-pilot` | Source checkout; `infra/` and `docs/runtime.md` contain launch/stop instructions |
| `work/native-agent/runtime` | Installed trusted runtime outside proposed checkouts |
| `work/native-agent/run-in-rex.sh` | Rex launcher; updates `agent.pid`, applies nice level 10, calls runtime startup script |
| `work/native-agent/agent.pid` | Last native PID; verify identity before signaling |
| `work/native-agent/state` | Review cache, PR admissions, and observed human-review state; retain during pilot continuation |
| `work/native-agent/builds` | Native checkout area |
| `work/native-agent/agent.log` | Historical pre-Rex log; current output is in Rex |
| `work/pilot-secrets/buildkite-agent-token` | Private seven-day registration token; never print or commit |
| `outputs/final-release-receipt.json` | Qualified artifact receipt |
| `outputs/outfitter-ci-pilot-0.1.0-5264279b9ce7.zip` | Qualified private release ZIP |

Docker Compose project is `outfitter-ci-pilot`, container `outfitter-ci-pilot-agent-1`, with a persistent build volume. Verification is limited to 2 CPU equivalents, 2 GiB memory, and 256 processes. Proposed code runs as UID 1001 without CI/model credentials; no host home or Docker socket is mounted. The native agent runs trusted review/fact collection only, with a dedicated Git config so it does not alter the user's global credential helper. Its current review model is `gpt-6.1-sol` through the existing Codex CLI login, not Pi.

The native process has a four-hour maximum uptime, last restarted at 12:47 PM Eastern November 10; it can finish an active job before exiting. Linux uses `restart: unless-stopped`. Neither archiving this chat nor switching Rex tabs is a worker teardown. No permanent native service, automatic wake, desktop-activity throttle, or native memory cap exists. Recheck process status and token validity before resuming; do not assume either worker is still online.

GitHub ruleset `26960468` on the pilot was configured with ALLGREEN merge queue, required PR/resolved threads, and the six `pilot/*` statuses tied to the Buildkite integration. Policy uses `pilot:automerge` applied by configured actor ID `25037981`; arbitrary labels are not landing authority. Review receipts/cache/admissions bind revisions and trusted runtime fingerprint. Treat IDs/settings as historical pointers and verify live state before mutation.

## Open work and acceptance gaps

1. Build Ranger's first useful Pi SDK slice and explicit role/resources. The offline RPC inspection and SDK bootstrap smoke made no inference calls; individual subscription logins, unattended provider refresh, live model execution, and concurrent provider behavior remain unqualified. Pi has native SDK/RPC, extensions, MCP, packages, and routing hooks; it is not an OS sandbox. JSON event output alone is not a valid review verdict.
2. Integrate Ranger into the disposable pilot, preserve structured evidence and all gates, and requalify before replacing the working Codex path.
3. Adopt a narrow deterministic operation into Forge with behavioral fixtures and a local entry point, then a thin CI adapter. Do not copy the whole pilot without preserving failure contracts.
4. [MONO-92](https://linear.app/outfitter/issue/MONO-92): validated revision-bound Devin findings provider. Current unresolved Devin threads block, but the required provider adapter is disabled; green status alone is insufficient.
5. [MONO-93](https://linear.app/outfitter/issue/MONO-93): simultaneous PR groups and refreshed admission when unrelated work advances main. Native-stack automatic rebase was observed; general concurrent-queue refresh was not.
6. Resolve private cross-owner distribution and credentials through a disposable consumer. See handoff for why checkout is not a workaround for job-level reusable-workflow access.
7. Plan stable worker installation paths and lifecycle, then measure capacity before increasing concurrency. Keep provider quota, workspace collisions, host load, and authority separate concerns.

Not completed: live assigned-human approval scenario (regression tests exist), Dagger execution, Turbo integration, production adoption, public packages, or GitHub release publication. The private ZIP and clean-consumer run are release qualification, not distribution. Optional advisory-model code is not the active decision path. [MONO-91](https://linear.app/outfitter/issue/MONO-91) is complete for the disposable pilot, not for all these follow-ups.

## Legacy preservation and archival readiness

New Ranger is at `/Users/mg/Developer/outfitter/ranger`. Previous agent-home Ranger is at `ranger-old`; the pre-existing older checkout was preserved as `ranger-old-2026-11-10`, with modified/untracked hashes verified. Both legacy origins point to `outfitter-dev/ranger-old`. The new repo has its own history.

New Forge is at `/Users/mg/Developer/outfitter/forge`; the archived predecessor is preserved at `forge-old`, including its dirty design note and a repaired external linked worktree. See the retirement note for exact paths. No legacy work was deleted. Hard-coded old automation/editor paths need owner-specific review before use.

The implementation sources, repo handoffs, this closeout, pilot evidence links, and Linear issues are the durable continuation record. The local token and runtime state remain machine-local by design. Archiving the chat is safe for recovering this session's work, but does not merge PRs, stop workers, retain Buildkite artifacts indefinitely, or finalize other agents' uncommitted work. The saved release receipt and ZIP provide a local artifact copy in addition to Buildkite storage.
