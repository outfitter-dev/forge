# Forge

Shared engineering automation for `outfitter-dev` and personal `galligan` repositories. Forge is intended to house reusable GitHub Actions, Buildkite integration, worker setup, local CI operations, and future Dagger or Turbo integration where useful.

Forge owns engineering workflows and evidence. [Ranger](https://github.com/outfitter-dev/ranger) owns the Pi agent harness and agent behavior. Product repositories retain their actual test/build commands and build graphs. Shared implementation does not imply shared credentials or authority.

## Foundation status

This is a private bootstrap, not a deployed automation platform. It includes Bun **1.4.4**, TypeScript **7.0.2**, Biome **2.6.6**, exact dependencies with a lockfile, and CI. `src/index.ts` intentionally exports no API yet. No runtime behavior or behavioral tests have been introduced; the test command accepts an empty suite until the first operation arrives.

```sh
bun install --frozen-lockfile
bun run check
```

The commands check formatting/lint, strict TypeScript, and any Bun tests. CI uses the same command and pinned GitHub Actions revisions. No secrets or global machine setup are needed.

## Start here

- [Implementation handoff](docs/handoff.md): scope, boundaries, evidence, cross-owner reuse, and the first implementation slice.
- [Legacy Forge retirement](docs/legacy-forge.md): preserved old repository, local checkout, and linked worktree.

The previous project named Forge is archived at [outfitter-dev/forge-old](https://github.com/outfitter-dev/forge-old). Its durable multi-agent operating-model design is historical material, not the specification for this new project. Existing `outfitter-dev/actions` and the Buildkite pilot remain operational; migration is explicit future work.
