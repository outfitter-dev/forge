# Forge

Read README.md, docs/handoff.md, and docs/legacy-forge.md before implementing. This is the shared engineering automation repository, not the legacy multi-agent operating-model project.

Use Bun and strict TypeScript. Prefer one implementation of an operation with thin GitHub Actions, Buildkite, and local adapters. Product repos own their task graphs; Ranger owns agent behavior. Keep organization/repository identity and authority explicit. Do not assume all consumers belong to Outfitter or share credentials.

Start with one package. Add directories and abstractions only when concrete adopted behavior needs them. Do not invent a scheduler, provider layer, or build system that existing tools supply. Tests must be offline and credential-free by default; new behavior requires corresponding tests. The bootstrap's empty-suite allowance is not permission to ship untested behavior.

Keep tokens, local state, logs, caches, and transcripts out of Git. Preserve trust boundaries when migrating pilot code: proposed code cannot control trusted orchestration or access privileged credentials. Model output cannot override deterministic blockers. Migration must retain revision-bound evidence and fail-closed handling.

Run `bun install --frozen-lockfile` and `bun run check`. Do not hard-wrap Markdown prose. Work on a feature branch and open a draft PR until CI passes. Do not migrate product repositories, alter cross-owner access, deploy workers, or publish packages as an incidental change.
