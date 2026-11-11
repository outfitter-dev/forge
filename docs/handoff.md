# Forge implementation handoff

Originally prepared November 10, 2026 for a private TypeScript/Bun bootstrap. Matt selected public source reuse on November 11; [public-readiness preparation](public-readiness.md) supersedes the original private-distribution constraint. Visibility remains unchanged pending Matt’s separate decision. Routine scoped delivery follows [standing delivery authority](../AGENTS.md#standing-delivery-authority), and actionable non-passes follow [owned failure recovery](../AGENTS.md#owned-failure-recovery). Historical authorization limits below describe their dated runs; they are not new per-step approval requirements. Explicit task holds and trust boundaries remain.

The seven original operational documents are verified in the [machine-local archive](public-readiness.md#operational-record-preservation); current guidance retains design findings without machine/session/account identifiers. Matt accepted the archive’s lack of long-term durability. Buildkite execution host is explicit configuration; Studio was one qualified pilot host, not Forge’s sole or permanent host. FOR-26’s merged optional-provider/versioned-evidence semantics govern review evidence; FOR-9 narrows supported Devin discovery, with no live provider qualification released here. The tokens artifact shadow trial and further loader/sandbox diagnosis are parked.

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

One unpublished package is enough initially. Add `actions/`, `.github/workflows/`, `buildkite/`, `workers/`, or Dagger modules when actual functionality lands. The present `.github/workflows/ci.yml` validates Forge itself; it is not a consumer workflow. Avoid empty frameworks and an organization-specific configuration hierarchy before the first real consumer.

## Bootstrap state

Bun 1.4.4 with native `bun check --no-script`, oxlint 1.93.0, oxfmt 0.78.0, Ultracite 8.1.1, exact dependency versions, committed Bun lockfile, strict typechecking, and pinned GitHub Actions. `bun run check` runs warning-as-error lint, format validation, native typechecking, and Bun tests. The test command requires a nonempty suite. [Tooling qualification](tooling.md) records deliberate source/test/config type-error failures, strict-option and warning probes, the accepted Ranger reference, and the editor dependency decision. Offline subprocess tests cover checkout bootstrap behavior; add meaningful tests with each new automation operation. Fresh checkouts and worktrees use `./scripts/bootstrap.sh` to validate the exact Bun pin and install frozen, independent dependencies.

FOR-28 now supplies [Forge check](forge-check.md): explicit project-command configuration invokes the existing `bun run check` aggregate through CLI, direct hook qualification and CI, with local receipts outside Git. Receipts record observations, not authenticated proof or permission to skip CI. Pinned Lefthook configuration does not activate shared hooks during frozen installation; `trustedDependencies: []` blocks its automatic install lifecycle.

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

The original MONO-91 pilot qualification remains historical evidence. Current FOR-9 investigates optional Devin findings; green status alone is not a clean-review verdict. FOR-11 treats stacks as primary and retains exact member/group mapping, passing-prefix and advancing-base qualification gaps. Creating Forge or Ranger does not resolve these gaps.

## Pilot evidence and recovery records

The [pilot summary](pilot-qualification.md) preserves the six-gate, revision-bound and credential-free proposal-execution findings; [session closeout](session-closeout.md) summarizes the originating decisions. Exact operational recovery pointers from seven original documents are verified in the primary checkout’s ignored `.archive/forge-operational-records/2026-11-11/`, with a SHA256/byte manifest and index. See [preservation evidence and limits](public-readiness.md#operational-record-preservation). This machine-local choice replaces the proposed private-pilot PR route; no pilot push, Buildkite job or worker operation was needed.

Host/operator, queue tags, trusted runtime, state/secret delivery and process identities are explicit configuration, not permanent source-code assumptions. Recheck mutable identity and availability for an agreed operation and preserve persistent state outside proposal cleanup. The historical pilot setup is not a current health, access, credential-validity or capacity guarantee. No runtime/state/secret file was archived or relocated by this documentation move.

## Intended public source reuse

Matt’s November 11 decision selects public Forge source as the distribution direction. After a separately authorized visibility change, a consumer can fetch an approved immutable Forge commit without a cross-owner private-source credential. Until that change, existing private access controls remain. `package.json` stays private; no package, public adapter or reusable-workflow interface is published by this decision.

The [public-readiness report](public-readiness.md) proposes FOR-6’s smaller remaining qualification: verify the exact repository/full source pin and Bun runtime, invoke the existing operation with explicit harmless facts/policy, and reject a wrong pin before invocation. The [private distribution analysis](private-distribution-analysis.md) is superseded planning; [selected-consumer qualification](distribution-qualification.md) remains dated private-at-the-time evidence. Preserve those historical subjects and limits rather than claiming they already qualify public reuse.

Forge commands are the primary entrypoint under the [November 11 direction](https://linear.app/outfitter/document/forge-direction-one-shape-from-worktree-to-release-38bbf3de42a1); FOR-28 now dogfoods [Forge check](forge-check.md) on Forge. A thin public Action is optional when a concrete consumer needs it, with its own immutable code/runtime/invocation contract and qualification. Job-level reusable-workflow resolution remains distinct from checkout in steps; source visibility does not create a missing interface. Product task graphs and artifact/release policy stay local. Public source grants no status, merge, release, credential or worker authority. Keep organization/repository identity explicit and untrusted proposal code outside privileged collection and action boundaries.

## Migration and next decisions

[Canonical CI and release patterns](ci-release-patterns.md) records FOR-22’s evidence-backed extraction selections. Current FOR-19 is CLI-first; FOR-20 preserves existing Actions consumers, FOR-21 maps capabilities to subsume into Forge, and FOR-23 sequences later monorepo command adoption after self-consumption and selected outside-consumer qualification. Reuse delivered FOR-18/FOR-24 primitives and policy/diff/version operations, preserving product policy and source/proof distinctions. Public Actions adapters are optional; qualify any selected interface rather than making one a delivery prerequisite. [Standing delivery authority](../AGENTS.md#standing-delivery-authority) now records FOR-27’s accepted policy; [owned failure recovery](../AGENTS.md#owned-failure-recovery) requires accountable ownership and a next action without weakening a non-passing gate. The local documentation archive route is resolved; live worker/qualification scope limits and the parked trial remain.

See [legacy-forge.md](legacy-forge.md) for the archived old project and preserved local worktree. Its old design documents are historical, not normative requirements here.

The first reusable slice now has one pure evaluator, a local JSON CLI, and a thin CI fixture step. Resolve distribution/access before promising cross-owner Actions reuse. Dagger integration, Turbo helpers, Ranger invocation, worker relocation, and production adoption should each be explicit subsequent slices. Keep existing consumers working while replacements qualify, and record divergence in the relevant Linear issue and migration documentation.
