# Forge

Shared engineering automation for `outfitter-dev` and personal `galligan` repositories. Forge is intended to house reusable GitHub Actions, Buildkite integration, worker setup, local CI operations, and future Dagger or Turbo integration where useful.

Forge owns engineering workflows and evidence. [Ranger](https://github.com/outfitter-dev/ranger) owns the Pi agent harness and agent behavior. Product repositories retain their actual test/build commands and build graphs. Shared implementation does not imply shared credentials or authority.

The first operation is a [pure deterministic evidence evaluator](docs/evidence-evaluator.md) for PR and merge-group qualification. It returns six structured gate decisions from normalized evidence and explicit policy, with offline tests for passing, blocked, and invalid input. It performs no collection, reporting, or landing actions. A [local JSON CLI](docs/evidence-cli.md) invokes the same operation: `bun run evaluate examples/evidence/passing-pr.json --policy examples/evidence/policy.json`. CI adapter qualification follows separately.

## Foundation status

This is a private package, not a deployed automation platform. It includes Bun **1.4.4**, TypeScript **7.0.2**, oxlint **1.69.0**, oxfmt **0.54.0**, Ultracite **7.8.3**, exact dependencies with a lockfile, and CI. `src/index.ts` exports the evaluator, validation boundary, and evidence contract. Offline tests cover evidence evaluation and checkout bootstrap behavior.

```sh
bun install --frozen-lockfile
bun run check
```

The commands check lint with oxlint, formatting with oxfmt, strict TypeScript, and any Bun tests. Lint and formatting use Ultracite presets, following Skillset’s configuration pattern, with Markdown prose wrapping disabled. Run `bun run format` to apply formatting. CI uses the same command and pinned GitHub Actions revisions. No secrets or global machine setup are needed.

## Start here

- [Design tenets](docs/tenets.md): how we build—modularity, contracts, observability, testability, and evolution.
- [Automation contract](docs/automation-contract.md): required behavior for evidence, authority, trust boundaries, and adoption.
- [Implementation handoff](docs/handoff.md): scope, boundaries, evidence, cross-owner reuse, and the first implementation slice.
- [Legacy Forge retirement](docs/legacy-forge.md): preserved old repository, local checkout, and linked worktree.

The previous project named Forge is archived at [outfitter-dev/forge-old](https://github.com/outfitter-dev/forge-old). Its durable multi-agent operating-model design is historical material, not the specification for this new project. Existing `outfitter-dev/actions` and the Buildkite pilot remain operational; migration is explicit future work.

## Checkout and worktree setup

Install the Bun version in `.bun-version` and make it available on `PATH`, then run `./scripts/bootstrap.sh` (or `bun run bootstrap`). The script resolves its own checkout, validates the exact Bun version, and runs `bun install --frozen-lockfile`. It is safe to repeat and reports installation failures without changing the lockfile or your global runtime. Run `bun run check` afterward to verify the checkout.

BB managed worktrees invoke `.bb-env-setup.sh`; Codex environment setup invokes the same bootstrap through `.codex/environments/environment.toml`. For a plain Git worktree, run the script explicitly after creation. Setup is repository code: run it only for a revision you trust, without privileged orchestration credentials.

Each worktree installs its own `node_modules`; bootstrap rejects a symlink rather than mutating another checkout's dependencies. `.worktreeinclude` intentionally has no copy patterns because development needs no local secrets or state. Git supplies tracked files. Worktree tools that support this convention may copy explicitly listed ignored files in the future; ordinary `git worktree add` does not consume it. No teardown hook is needed: setup creates only ignored dependencies inside the worktree, whose removal remains the worktree manager's responsibility.
