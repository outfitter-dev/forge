# Forge

Read README.md, docs/tenets.md, docs/automation-contract.md, docs/handoff.md, and docs/legacy-forge.md before implementing. docs/tenets.md governs how we build; docs/automation-contract.md governs behavior and trust boundaries. This is the shared engineering automation repository, not the legacy multi-agent operating-model project.

Use Bun and strict TypeScript. Prefer one implementation of an operation with thin GitHub Actions, Buildkite, and local adapters. Product repos own their task graphs; Ranger owns agent behavior. Keep organization/repository identity and authority explicit. Do not assume all consumers belong to Outfitter or share credentials.

Start with one package. Add directories and abstractions only when concrete adopted behavior needs them. Do not invent a scheduler, provider layer, or build system that existing tools supply. Tests must be offline and credential-free by default; new behavior requires corresponding tests. Run `./scripts/bootstrap.sh` in a fresh checkout or worktree before checks; it requires the exact Bun pin on PATH and installs independent dependencies.

Keep tokens, local state, logs, caches, and transcripts out of Git. Preserve trust boundaries when migrating pilot code: proposed code cannot control trusted orchestration or access privileged credentials. Model output cannot override deterministic blockers. Migration must retain revision-bound evidence and fail-closed handling.

Run `bun install --frozen-lockfile` and `bun run check`. Do not hard-wrap Markdown prose. Work on a feature branch and open a draft PR until CI passes.

## Standing delivery authority

For work within the agreed task scope, proceed with PR preparation, opening, checks, review, repair, rechecking, and eligible merge without asking Matt for per-PR or per-step permission. This policy records Matt's November 11, 2026 [direction](https://linear.app/outfitter/document/forge-direction-one-shape-from-worktree-to-release-38bbf3de42a1). It supplies standing authority; a passing evaluator result supplies evidence, not authority by itself.

Matt reaffirmed this authority on November 12, 2026, approving future scoped merges when independent reviews are satisfactory and CI is green. Proactively land eligible lower branches while continuing work above them. After a lower merge changes a dependent layer's head or applicable base, obtain fresh checks and independent review for that layer before landing it. The confirmation and proactive delivery instruction are recorded on [FOR-37](https://linear.app/outfitter/issue/FOR-37).

- Before landing, verify fresh evidence for the repository, latest head and applicable base, passing applicable gates, an independent completed review, and no unresolved blocking findings. Follow the trusted repository rules and landing path. No named review provider is mandatory; preserve the evidence requirements in the [automation contract](docs/automation-contract.md).
- Release within the agreed product scope when established product release policy qualifies the release and the trusted setup supports the operation. Honor product-required approvals and destinations. Do not invent credentials, infrastructure, access, or release defaults to make a release eligible. Product migration and worker deployment need an agreed task scope; they are not incidental consequences of a passing check.
- Ask Matt before making a repository public, changing access or credentials, or deleting things. Routine delivery authority does not waive these exceptions.
- Preserve explicit task holds and scope limits. A parked task resumes only when its owner releases the hold; routine delivery authority does not release it.
- Treat `forge:hold` as a landing hold and `forge:hotfix` as a priority signal, never a gate bypass. These names describe policy vocabulary; they do not establish that labels, queue automation, or repository settings are installed.

Review independence requires clean context without inherited author or parent reasoning. An author may launch that reviewer, but must supply the review scope and evidence without supplying the author's verdict.

## Owned failure recovery

A deterministic non-passing result stops the affected progression; it does not require an unattended wait or a new permission request. Missing, stale, failed, or incomplete required evidence stays non-passing throughout recovery.

Forge reports structured facts and evaluates gates. Ranger owns execution, repair/retry loops, and review fallback. For each actionable non-pass, record the failed requirement, reason, accountable next owner, and next action. Route failures in the change to the authoring owner and unavailable review to Ranger's eligible independent-review fallback. After repair changes the head or an evidence assumption changes, obtain fresh applicable checks and review before landing.

Recovery follows the bounds agreed for the task or consumer; this policy sets no global retry cap. When those bounds are exhausted, stop further attempts and hand the evidence and next action to the accountable engineering owner. Keep ownership until the handoff is accepted. Escalate to Matt when resolution requires a decision only he can make, including the three exceptions above. An exhausted loop alone does not establish that condition. Ranger owns the recovery contract; Forge must not add an agent loop or scheduler to implement this policy.

Use this policy by reference in active guidance. Preserve dated qualification records as historical evidence, including their original authorization limits; historical limits are not new per-step approval gates for routine work. Check consequential boundaries against the [policy examples](docs/standing-delivery-examples.md).
