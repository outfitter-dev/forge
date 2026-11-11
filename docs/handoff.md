# Forge implementation handoff

Originally prepared November 10, 2026 for a private TypeScript/Bun bootstrap. Matt selected public source reuse on November 11; [public-readiness preparation](public-readiness.md) supersedes the original private-distribution constraint. Visibility remains unchanged pending separate authorization. No production migration is authorized by this handoff.

The operational sections below remain preserved pending verified archival in the private pilot repository. Their machine/session/process observations are historical. Buildkite execution host is explicit configuration; Studio was one qualified pilot host, not Forge’s sole or permanent host. FOR-26 owns the current optional-provider/versioned-evidence policy work and the narrowing of FOR-9; no provider-policy implementation or live provider qualification is selected here. The tokens artifact shadow trial and further loader/sandbox diagnosis are parked.

For the complete originating-session record, including worker recovery details and superseded decisions, read [session closeout](session-closeout.md) and [pilot qualification](pilot-qualification.md).

## Intended scope

[Forge’s design tenets](tenets.md) govern construction principles; the [automation contract](automation-contract.md) governs evidence, authority, trust boundaries, and migration. This handoff records current scope and evidence; it does not override those principles. The initial principles and behavioral guarantees were compared with the proposed [Ranger tenets in PR #3](https://github.com/outfitter-dev/ranger/pull/3) at revision `626baab`, then reviewed against the construction/operating-contract split at `b815e01`. The shared principles align on contracts, evidence, explicit authority, and faithful provider semantics. Ranger owns agent workflows; Forge owns engineering automation; execution hosts enforce permissions and isolation. This alignment does not establish a cross-project API.

Forge serves both `outfitter-dev` and personal `galligan` repositories. It can contain reusable GitHub Actions and workflows, Buildkite pipeline integration, worker provisioning and launchers, shared local CI operations, release qualification, and future Dagger or Turbo support. Keep execution-environment adapters thin around reusable operations.

Boundaries:

- **Forge:** engineering workflows, orchestration adapters, worker setup, evidence collection, deterministic gates, release qualification.
- **Ranger:** Pi harness, agent roles, tools, prompts, model/provider selection, sessions, and structured agent results. Prefer its supported API/CLI contract when established; do not duplicate Pi's agent loop in Forge.
- **Product repositories:** their build/test/lint commands, package definitions, Turbo task graphs, and small explicit policy/configuration inputs.
- **Hosted services:** actual GitHub/Buildkite integrations, queues, rulesets, and access settings. Version reproducible definitions here as they are adopted.
- **Private machine storage:** credentials, caches, checked-out jobs, logs, and runtime state. Never commit these.

One private package is enough initially. Add `actions/`, `.github/workflows/`, `buildkite/`, `workers/`, or Dagger modules when actual functionality lands. The present `.github/workflows/ci.yml` validates Forge itself; it is not a consumer workflow. Avoid empty frameworks and an organization-specific configuration hierarchy before the first real consumer.

## Bootstrap state

Bun 1.4.4 with native `bun check --no-script`, oxlint 1.93.0, oxfmt 0.78.0, Ultracite 8.1.1, exact dependency versions, committed Bun lockfile, strict typechecking, and pinned GitHub Actions. `bun run check` runs warning-as-error lint, format validation, native typechecking, and Bun tests. The test command requires a nonempty suite. [Tooling qualification](tooling.md) records deliberate source/test/config type-error failures, strict-option and warning probes, the accepted Ranger reference, and the editor dependency decision. Offline subprocess tests cover checkout bootstrap behavior; add meaningful tests with each new automation operation. Fresh checkouts and worktrees use `./scripts/bootstrap.sh` to validate the exact Bun pin and install frozen, independent dependencies.

`src/index.ts` exports the first deterministic evidence operation and its versioned input/output contract; see [evidence evaluation](evidence-evaluator.md). There are no Ranger, Dagger, Turbo, Buildkite, or GitHub SDK dependencies. No package has been published, no credentials copied, and no global installations or worker deployments performed.

## First useful slice

FOR-2 implements deterministic evaluation of normalized check/review evidence: explicit facts and policy produce separate lint, test, build, agent-review, human-review, and landing decisions. [The operation contract](evidence-evaluator.md) records the verified pilot baseline, strict input validation, provenance requirements, PR/merge-group semantics, offline fixtures, and deliberate adaptations. FOR-3 adds the [local JSON CLI](evidence-cli.md) and committed examples with offline subprocess qualification. FOR-4 adds a named [CI fixture step](evidence-cli.md#ci-adapter-qualification) that runs the same CLI subprocess suite; expected blocked/malformed cases assert failure results without failing the job. No live consumer migration is included.

Keep head/base revision identity, required-evidence completeness, provider/runtime identity, and explicit authority intact. Missing, stale, canceled, failed, or incomplete required evidence must not become a pass. Agent judgment cannot override deterministic blockers. A successful API request is not proof that model work completed or a PR landed.

Do not move the entire pilot as one mechanical copy. Carry the tests and concrete failure cases for each adopted operation. Product consumers must be qualified before removing their previous implementation.

## Existing sources and live evidence

- [outfitter-dev/actions](https://github.com/outfitter-dev/actions): existing shared Actions/release primitives. Read its own guidance before changes. Nothing there is deprecated by this bootstrap.
- [outfitter-dev/ranger](https://github.com/outfitter-dev/ranger): new Pi harness foundation; start with its `docs/handoff.md`. Its initial PR is [Ranger #1](https://github.com/outfitter-dev/ranger/pull/1); recheck current development before depending on an API.
- [agentic-ci-pilot](https://github.com/outfitter-dev/agentic-ci-pilot): private self-hosted Buildkite experiment with 204 tests at qualification. Its `machinery/`, `reviewer/`, `infra/`, and `docs/` separate reusable orchestration from the small fixture app.
- [Build 17](https://buildkite.com/outfitter/agentic-ci-pilot/builds/17): actual initial merge-queue candidate passed.
- [Build 25](https://buildkite.com/outfitter/agentic-ci-pilot/builds/25): passing lower native-stack layer landed while the deliberately failing upper layer stayed blocked.
- [Build 34](https://buildkite.com/outfitter/agentic-ci-pilot/builds/34): repaired upper layer passed candidate checks and landed.
- [Build 35](https://buildkite.com/outfitter/agentic-ci-pilot/builds/35): main checks, private artifact packaging, source/digest validation, and clean-consumer smoke passed.

The pilot uses six distinct statuses: lint, test, build, agent review, assigned-human review, and merge eligibility. Retain that separation. Its reviewer uses the authenticated Codex CLI, not Ranger/Pi yet. Review receipts are tied to exact head/base revisions and trusted runtime; changed model/harness/prompt configuration must invalidate cached evidence.

[MONO-91](https://linear.app/outfitter/issue/MONO-91) records completed pilot qualification. [MONO-92](https://linear.app/outfitter/issue/MONO-92) tracks the required Devin findings adapter: unresolved GitHub threads block today, but a green Devin status is not a clean-review verdict. [MONO-93](https://linear.app/outfitter/issue/MONO-93) tracks simultaneous PR groups and automatic admission refresh when unrelated work advances main. Creating Forge or Ranger does not resolve these gaps.

The [established pilot setup](#established-pilot-setup) below records the existing Studio/Rex workers and read-only verification. Reuse it where suitable; do not repeatedly ask Matt to select the host or recreate workers. The [worker lifecycle plan](worker-lifecycle-plan.md) governs future relocation/service lifecycle and evidence before more concurrency, not selection of the already established host. Availability remains time-sensitive; no permanent installation, native memory cap, or desktop-load throttle is established. [Devin findings discovery](devin-findings-discovery.md) separates this setup from the remaining Devin API access and supported-findings gap.

Local pilot checkout: `~/Documents/Codex/2026-11-10/i/work/agentic-ci-pilot`. Its private runtime/secrets are outside the checkout. Saved evidence: `~/Documents/Codex/2026-11-10/i/outputs/pilot-report.md`. Those temporary paths are not the intended permanent infrastructure layout.

## Established pilot setup

Matt confirmed the existing Buildkite worker setup in Rex on November 10, 2026 and requested read-only inspection. At approximately 22:15 UTC, Rex session/process metadata, bounded recent pane output, selected runtime source hashes, directory metadata, and selected Docker inspection fields established the following. No input was sent to worker panes, processes restarted/signaled, secret values read, or worker configuration changed. These facts supersede host-selection uncertainty in the historical closeout; they are not a permanent health or unattended-access guarantee.

| Established identity | Verified fact |
| --- | --- |
| Host/operator | Matt's Studio, local Rex host ID `24a140f8-a090-4b21-a7a0-5c1772a68007`; process account `mg` (UID 501). Reuse this approved host/setup where suitable. |
| Session/tab | `remotes`, session `session:01a1b1de-3fa7-77c4-ab78-9350e6391db0`; `buildkite-workers`, window `window:01a1c692-7c49-7cc5-93cc-817180fe37c7`. |
| Layout | Equal horizontal 50/50 split: native review left, container verification right. Preserve the layout; pane IDs must be re-resolved if replaced. |
| Native pane | `block:01a1c692-7c28-78ca-9792-a815cc7a794e`. At inspection Rex reported exit 0; output records the four-hour limit and disconnect at 16:47:32 Eastern. No active native reviewer was established by that pane. This is availability, not a host-selection decision or permission to restart. |
| Verification pane | `block:01a1c692-a431-7153-9012-d34a9577a310`. Foreground Docker/OrbStack process PID 99820 under `mg`, working directory the pilot source checkout; recent Linux agent heartbeat output. PID is a dated observation, never sufficient signaling authority. |
| Container | `outfitter-ci-pilot-agent-1` running; image tag `outfitter-agentic-ci-pilot:local`, inspected image ID `sha256:ee9e3467119cf010580a05b08aec73adf4b74592d5a18aa3b1795a2185d968c4`. A local tag is mutable. |
| Container boundaries | Two CPU equivalents, 2 GiB memory, 256 processes, non-privileged container, `unless-stopped` restart policy. Inspected mounts: persistent `outfitter-ci-pilot_builds` volume at `/var/lib/buildkite`, and the token file read-only at `/run/secrets/buildkite-agent-token`; no host-home or Docker-socket mount. |

A separately authorized [FOR-11 bounded baseline run](queue-refresh-qualification.md) later started the existing native launcher once and restored stopped availability by graceful exit 0 at 23:12:23 UTC. Its replacement left pane is `block:01a1c7a9-8252-7dbb-aebb-9dbf42e8ca95`; the original exited block above remains preserved detached. The unchanged verification pane retained focus and the 50/50 split; Linux remained running with the same image. Selected synthetic cache/admission records were inspected for this run and retained. These later observations do not authorize another start or change the historical 22:15 inspection limits.

The container agent's configured user is empty/default, not UID 1001. The reviewed pilot execution source explicitly requires the trusted root worker and drops proposed commands to UID/GID 1001 with cleared groups and a minimal environment. Container limits and mounts were inspected; this documentation task did not execute a proposal or prove every enforcement path anew. Native nice level 10 is the recorded launcher policy, not a CPU/memory cap; the exited native process supplied no current nice measurement. Keep the existing one-review/one-verification slot arrangement; no capacity increase is authorized.

All path references below are under `/Users/mg/Documents/Codex/2026-11-10/i/`:

| Location | Established role and verification limit |
| --- | --- |
| `work/agentic-ci-pilot` | Source checkout, distinct from installed runtime and job proposals. Inspected HEAD `897810f03bc14098809c5a113472649923d0d905`; selected source blobs match qualified `5264279b9ce776d2a8f8e6c3785c663d9b653cf8` on GitHub. |
| `work/native-agent/runtime` | Existing installed trusted runtime outside proposed checkouts; owner-only directory under `mg`. Selected `github_reviews.py`, `merge_queue.py`, and `host_worker.py` contents match the inspected source checkout. This is a limited comparison, not attestation of every runtime file/configuration/executable. |
| `work/native-agent/state` | Existing owner-only persistent directory for cache/admissions/human ledger; preserve it. Only directory metadata was inspected, not private records. |
| `work/native-agent/builds`, `run-in-rex.sh`, `agent.pid` | Documented native job area, launcher, and PID reference. Runtime/ledger must remain outside proposal cleanup. PID-file contents and job state were not read here. |
| `work/pilot-secrets/buildkite-agent-token` | Existing registration-token location; Docker mount metadata confirms delivery as a read-only file. No value, validity or expiry was inspected. Reference only; do not copy it into Forge or proposals. |

The installed native hook path and container `/opt/pilot` source own trusted orchestration; proposed checkouts cannot replace them. Buildkite registration authority and existing GitHub/Codex access do not confer Devin API permission. The Devin General page identifies Outfitter's API organization as `org_LrVVGgDvqRmcs9J3` (web slug `maybe-good-systems`), verified read-only. Matt is custodian of a service-user token with a stated 90-day lifetime; protected delivery as `DEVIN_API_TOKEN` is confirmed. At 22:22 UTC a supported GET lookup of an existing Forge review succeeded; pilot PR #3 returned 404. Exact expiry/full granted scope remain unverified, and neither response supplies findings/base/completeness. No value or local secret path belongs here. The supported findings contract remains FOR-9's blocker; the established host does not need reapproval. See the discovery record for the precise evidence and limits. Recheck time-sensitive identity, availability and evidence before an authorized operation, preserving state and layout. Permanent service/placement changes, renewal, restarts and broader capacity remain separate operations.

## Pilot session closeout

The supplemental archive entry point is `~/Documents/Codex/2026-11-10/i/outputs/session-closeout.md`, supplied by Matt after this handoff. Read it before resuming pilot integration or worker work; it links the implementation handoff and `pilot-qualification.md`, and records recovery pointers, preserved runtime state, and local release artifacts. It is a historical snapshot; current repository and live service state take precedence.

The closeout records final pilot source `5264279b9ce776d2a8f8e6c3785c663d9b653cf8`. It distinguishes private release qualification from distribution and explicitly leaves live assigned-human approval, simultaneous PR-group admission refresh, validated Devin findings, and Ranger replacement of the working Codex reviewer unqualified. Preserve the existing native review state during continuation. Worker availability, registration validity, and Rex pane identifiers must be rechecked before operation; archiving the originating chat does not stop workers. These pointers do not authorize deployment or migration.

## Intended public source reuse

Matt’s November 11 decision selects public Forge source as the distribution direction. After a separately authorized visibility change, a consumer can fetch an approved immutable Forge commit without a cross-owner private-source credential. Until that change, existing private access controls remain. `package.json` stays private; no package, public adapter or reusable-workflow interface is published by this decision.

The [public-readiness report](public-readiness.md) proposes FOR-6’s smaller remaining qualification: verify the exact repository/full source pin and Bun runtime, invoke the existing operation with explicit harmless facts/policy, and reject a wrong pin before invocation. The [private distribution analysis](private-distribution-analysis.md) is superseded planning; [selected-consumer qualification](distribution-qualification.md) remains dated private-at-the-time evidence. Preserve those historical subjects and limits rather than claiming they already qualify public reuse.

A later thin adapter still needs its own immutable code/runtime/invocation contract and concrete consumer qualification. Job-level reusable-workflow resolution remains distinct from checkout in steps; source visibility does not create a missing interface. Product task graphs and artifact/release policy stay local. Public source grants no status, merge, release, credential or worker authority. Keep organization/repository identity explicit and untrusted proposal code outside privileged collection and action boundaries.

## Migration and next decisions

[Canonical CI and release patterns](ci-release-patterns.md) records FOR-22's evidence-backed extraction selections for FOR-19 and the FOR-21 Belay decision. Reuse the delivered FOR-18/FOR-24 qualification primitives, preserve product policy and source/proof distinctions, and treat proposed public adapters as unqualified until their access/runtime/consumer contracts pass. The map authorizes no adoption or retirement.

See [legacy-forge.md](legacy-forge.md) for the archived old project and preserved local worktree. Its old design documents are historical, not normative requirements here.

The first reusable slice now has one pure evaluator, a local JSON CLI, and a thin CI fixture step. Resolve distribution/access before promising cross-owner Actions reuse. Dagger integration, Turbo helpers, Ranger invocation, worker relocation, and production adoption should each be explicit subsequent slices. Keep existing consumers working while replacements qualify, and record divergence in the relevant Linear issue and migration documentation.
