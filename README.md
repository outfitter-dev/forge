# Forge

Shared engineering automation for repositories with explicit product policy and authority, including `outfitter-dev` and personal `galligan` consumers. Forge is intended to house reusable GitHub Actions, Buildkite integration, worker setup, local CI operations, and future Dagger or Turbo integration where useful. Matt selected public source reuse on November 11, 2026; the repository remains private until a separately authorized visibility change after [public-readiness preparation](docs/public-readiness.md).

Some historical evidence links target private repositories or Linear records and may be unavailable to outside readers. They remain provenance references, not public dependencies or promises of access.

[Standing delivery authority](AGENTS.md#standing-delivery-authority) governs routine scoped PR/check/review/eligible merge and the exceptions requiring Matt’s decision. [Owned failure recovery](AGENTS.md#owned-failure-recovery) assigns non-passing work to an accountable owner and next action. Explicit task holds and evidence/trust requirements remain.

Forge owns engineering workflows and evidence. [Ranger](https://github.com/outfitter-dev/ranger) owns the Pi agent harness and agent behavior. Product repositories retain their actual test/build commands and build graphs. Shared implementation does not imply shared credentials or authority.

The first operation is a [pure deterministic evidence evaluator](docs/evidence-evaluator.md) for PR and merge-group qualification. It returns six structured gate decisions from normalized evidence and explicit policy, with offline tests for passing, blocked, and invalid input. It performs no collection, reporting, or landing actions. A [local JSON CLI](docs/evidence-cli.md) invokes the same operation: `bun run evaluate examples/evidence/passing-pr.json --policy examples/evidence/policy.json`. A named [CI qualification step](docs/evidence-cli.md#ci-adapter-qualification) exercises that entry point through the same offline subprocess suite.

[Immutable npm evidence](docs/npm-evidence.md) adds registry-metadata classification and bounded read-only observation of a product-supplied publication set. It preserves integrity conflicts, partial propagation and unavailable evidence; its provenance checks validate references, not authenticated producers. It includes no publisher or network implementation.

[Package artifact validation](docs/package-artifact-validation.md) evaluates actual packed-file/manifest evidence and revision-bound clean-consumer checks against an explicit product contract. Offline disposable-package tests exercise installation, runtime imports and type resolution; product owners retain their packaging and source-versus-built choices.

[Pure release-policy routing](docs/release-policy.md) adapts block/none/manual/auto intent classification under explicit product safety, channel and CI requirements. It preserves exact subject/policy bindings and grants no publishing or approval authority.

[Generated-release diff assessment](docs/generated-release-diff.md) checks complete, revision-bound path/status evidence against explicit product manifest/changelog pairs and deletable changeset paths. It qualifies file roles without claiming that modified content is a valid version bump.

[Strict version/channel assessment](docs/release-version.md) checks literal version progression and product-declared destination tags. Malformed versions block; valid build metadata preserves prerelease routing and cannot alone establish a newer version.

[Offline release composition](docs/release-composition.md) demonstrates explicit product mapping of diff/version/artifact/npm outcomes into required and auto-only release assessments, including manual-path blockers and the remaining minimum for a real consumer trial.

## Foundation status

This is an unpublished package, not a deployed automation platform. `package.json` retains `"private": true` to prevent incidental package publication; source visibility and npm publication are separate decisions. Source licensing is MIT; see [LICENSE](LICENSE). It includes Bun **1.4.4** with native typechecking, oxlint **1.93.0**, oxfmt **0.78.0**, Ultracite **8.1.1**, exact dependencies with a lockfile, and CI. `src/index.ts` exports the evaluator, validation boundary, and evidence contract. Offline tests cover evidence evaluation and checkout bootstrap behavior.

```sh
bun install --frozen-lockfile
bun run forge check
```

The commands check lint with oxlint (warnings fail), formatting with oxfmt, strict types with `bun check --no-script`, and Bun tests. Lint and formatting use Ultracite presets with Markdown prose wrapping disabled. [Tooling qualification and editor guidance](docs/tooling.md) records the accepted Ranger reference, strict/config-file checks, and the decision to omit a separate editor TypeScript pin. Run `bun run format` to apply formatting. [Forge check](docs/forge-check.md) invokes the existing `bun run check` aggregate from explicit `forge.json` configuration and records local execution observations. CLI, direct hook qualification and CI use that same operation; receipts do not authenticate a producer or skip CI. Hooks are configured without installation during dependency setup; activation requires checkout-owner coordination. No secrets or global machine setup are needed.

## Start here

- [Design tenets](docs/tenets.md): how we build—modularity, contracts, observability, testability, and evolution.
- [Automation contract](docs/automation-contract.md): required behavior for evidence, authority, trust boundaries, and adoption.
- [Canonical CI and release patterns](docs/ci-release-patterns.md): audited source evidence, selected operation/adapter boundaries and product-owned behavior; extraction guidance without adoption or Belay-retirement claims.
- [Implementation handoff](docs/handoff.md): scope, boundaries, evidence, cross-owner reuse, and the first implementation slice.
- [Legacy Forge retirement](docs/legacy-forge.md): preserved old repository, local checkout, and linked worktree.
- [Worker lifecycle plan](docs/worker-lifecycle-plan.md): proposed ownership, preservation, lifecycle, and bounded capacity qualification; no deployment authorization.
- [Human approval qualification brief](docs/human-approval-qualification.md): proposed disposable consumer, actor policy, scenarios, access decisions, and evidence; no live qualification authorization.

The previous project named Forge is archived at [outfitter-dev/forge-old](https://github.com/outfitter-dev/forge-old). Its durable multi-agent operating-model design is historical material, not the specification for this new project. Existing `outfitter-dev/actions` and the Buildkite pilot remain operational; migration is explicit future work.

## Checkout and worktree setup

Install the Bun version in `.bun-version` and make it available on `PATH`, then run `./scripts/bootstrap.sh` (or `bun run bootstrap`). The script resolves its own checkout, validates the exact Bun version, and runs `bun install --frozen-lockfile`. It is safe to repeat and reports installation failures without changing the lockfile or your global runtime. Run `bun run forge check` afterward to verify the checkout through the same command used by CI.

BB managed worktrees invoke `.bb-env-setup.sh`; Codex environment setup invokes the same bootstrap through `.codex/environments/environment.toml`. For a plain Git worktree, run the script explicitly after creation. Setup is repository code: run it only for a revision you trust, without privileged orchestration credentials.

Each worktree installs its own `node_modules`; bootstrap rejects a symlink rather than mutating another checkout's dependencies. `.worktreeinclude` intentionally has no copy patterns because development needs no local secrets or state. Git supplies tracked files. Worktree tools that support this convention may copy explicitly listed ignored files in the future; ordinary `git worktree add` does not consume it. No teardown hook is needed: setup creates only ignored dependencies inside the worktree, whose removal remains the worktree manager's responsibility.
