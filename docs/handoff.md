# Forge implementation handoff

Prepared November 10, 2026. This is a fresh private repository for shared engineering automation. The user requested a TypeScript/Bun foundation and handoff, with cross-owner reuse left to be resolved. No production migration is authorized merely by this document.

## Intended scope

[Forge’s design tenets](tenets.md) govern implementation and migration decisions. This handoff records current scope and evidence; it does not override those principles. The tenets were compared with the proposed [Ranger tenets in PR #3](https://github.com/outfitter-dev/ranger/pull/3) at revision `626baab`. The shared principles align on contracts, evidence, explicit authority, and faithful provider semantics. Ranger owns agent workflows; Forge owns engineering automation; execution hosts enforce permissions and isolation. This alignment does not establish a cross-project API.

Forge serves both `outfitter-dev` and personal `galligan` repositories. It can contain reusable GitHub Actions and workflows, Buildkite pipeline integration, worker provisioning and launchers, shared local CI operations, release qualification, and future Dagger or Turbo support. Keep execution-environment adapters thin around reusable operations.

Boundaries:

- **Forge:** engineering workflows, orchestration adapters, worker setup, evidence collection, deterministic gates, release qualification.
- **Ranger:** Pi harness, agent roles, tools, prompts, model/provider selection, sessions, and structured agent results. Prefer its supported API/CLI contract when established; do not duplicate Pi's agent loop in Forge.
- **Product repositories:** their build/test/lint commands, package definitions, Turbo task graphs, and small explicit policy/configuration inputs.
- **Hosted services:** actual GitHub/Buildkite integrations, queues, rulesets, and access settings. Version reproducible definitions here as they are adopted.
- **Private machine storage:** credentials, caches, checked-out jobs, logs, and runtime state. Never commit these.

One private package is enough initially. Add `actions/`, `.github/workflows/`, `buildkite/`, `workers/`, or Dagger modules when actual functionality lands. The present `.github/workflows/ci.yml` validates Forge itself; it is not a consumer workflow. Avoid empty frameworks and an organization-specific configuration hierarchy before the first real consumer.

## Bootstrap state

Bun 1.4.4, TypeScript 7.0.2, oxlint 1.69.0, oxfmt 0.54.0, Ultracite 7.8.3, exact dependency versions, committed Bun lockfile, strict typechecking, and pinned GitHub Actions. `bun run check` runs lint/format validation, typechecking, and Bun tests. The test command currently permits zero tests because this bootstrap intentionally implements no runtime operation. Add meaningful tests with the first behavior.

`src/index.ts` is an empty module boundary, not a stable public API. There are no Ranger, Dagger, Turbo, Buildkite, or GitHub SDK dependencies yet. Choose dependencies only for the adopted first slice. No package has been published, no credentials copied, and no global installations or worker deployments performed.

## First useful slice

Select one independently useful operation from the working pilot or existing Actions repository. A good candidate is the deterministic evaluation of normalized check/review evidence: input facts and policy produce a structured pass/fail result, independent of runner or organization. Confirm the source's current contract, then port the smallest vertical slice with passing and failing fixtures. Expose it locally first and prove one CI adapter invokes the same operation. This is a suggested starting point, not an already-approved schema or API.

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

Studio workers are visible in Rex session `remotes`, tab `buildkite-workers`, with native review and container verification panes. Capacity is one review job plus one verification job. Verification is capped at two CPU equivalents and 2 GiB RAM; native review uses nice level 10. The native pilot process has a four-hour lifetime, most recently restarted at 12:47 PM Eastern on November 10. Verify live state before changing workers. No permanent installation or automatic desktop-load throttling has been implemented.

Local pilot checkout: `~/Documents/Codex/2026-11-10/i/work/agentic-ci-pilot`. Its private runtime/secrets are outside the checkout. Saved evidence: `~/Documents/Codex/2026-11-10/i/outputs/pilot-report.md`. Those temporary paths are not the intended permanent infrastructure layout.

## Private cross-owner reuse: unresolved by design

Keep Forge private for now. GitHub documents standard private Actions/workflow sharing within the same owner or organization. Merely allowing other `outfitter-dev` repositories does not establish direct reuse from personal `galligan` repositories. Enterprise sharing has separate ownership/visibility/policy conditions; do not assume a personal account participates.

Official references checked November 10, 2026:

- [Sharing with your organization](https://docs.github.com/en/actions/how-tos/reuse-automations/share-with-your-organization).
- [Repository Actions access settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-your-repository).
- [Reusable workflow access](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).

Evaluate these options with a disposable consumer before adopting one:

1. For shared scripts or local/composite actions, explicitly fetch an immutable Forge revision using a narrowly scoped credential accessible to that consumer, then invoke it locally. Verify the selected action type's build/runtime requirements. A caller's ordinary `GITHUB_TOKEN` should not be assumed to read another owner's private repo.
2. For reusable workflows, validate supported service access separately. A job-level `uses: owner/repo/.github/workflows/file.yml@ref` is resolved before checkout steps; checking out Forge inside that same job is not a workaround for unavailable workflow access. Thin consumer workflows calling authenticated shared code may be preferable.
3. Consider a private package or immutable artifact with explicitly tested cross-owner authentication, or a later public release of non-sensitive reusable components. Neither publication nor credentials are configured by this bootstrap.

Keep code reuse and authority separate. Repository identity, landing actors, required checks, review providers, worker queues, and release destinations must be explicit inputs. Do not grant personal jobs Outfitter credentials merely because they use the same code. Validate both private and public consumer needs before choosing a distribution mechanism.

## Migration and next decisions

See [legacy-forge.md](legacy-forge.md) for the archived old project and preserved local worktree. Its old design documents are historical, not normative requirements here.

Next agent: choose the first operation and its source owner; define its pure input/output contract and tests; qualify local execution; then add one CI consumer. Resolve distribution/access before promising cross-owner Actions reuse. Dagger integration, Turbo helpers, Ranger invocation, worker relocation, and production adoption should each be explicit subsequent slices. Keep existing consumers working while replacements qualify, and record divergence in the relevant Linear issue and migration documentation.
