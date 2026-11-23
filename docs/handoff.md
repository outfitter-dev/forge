# Forge implementation handoff

Current milestone is one live build on a Forge pull request that posts the rolled-up gate status from a trusted Buildkite lane. [FOR-38](https://linear.app/outfitter/issue/FOR-38) owns that milestone. Its next action is to finish the trusted lane configuration, connect the delivered operations and qualify the run. Until that run exists, new operations without a consumer are on hold.

## What runs today

Forge's GitHub Actions `check` job runs `bun run forge check` and the evaluator CLI fixtures. The [advisory Ropes Markdown job](../README.md#advisory-markdown-check) runs alongside it. Fresh checkouts use `./scripts/bootstrap.sh` with the exact Bun pin in `.bun-version`.

The repository is public under MIT. The package remains unpublished with `private: true`. Consumers can select an immutable source revision, subject to their own runtime and integration qualification. [Standing delivery authority](../AGENTS.md#standing-delivery-authority) and [owned failure recovery](../AGENTS.md#owned-failure-recovery) govern scoped delivery.

## Built and awaiting adoption

[Forge gate](forge-gate.md) collects and evaluates a pull request locally. The root [`forge-gate.json`](../forge-gate.json) declares Forge's policy, but no lane reads it yet. The [Buildkite implementation](buildkite-pipeline.md) includes admission, authenticated host dispatch, project checks, receipt verification and an offline status-refresh preview. Those pieces have offline coverage. The complete trusted lane still needs live qualification. The [November 23 service check](https://linear.app/outfitter/issue/FOR-38#comment-438a16e6-50ac-40ab-91d0-16ed877e7400) found connected `forge-worker-project` and `forge-worker-trusted` agents with unpaused queues. The only configured pipeline is the existing pilot. Forge still needs its own pipeline.

Hosted Codex review has [bounded qualification evidence](codex-command-qualification.md) and an [adopted policy entry](hosted-reviewer-attestations.md#adopted-policy-entry). The production lane must still establish authenticated collection, finding completeness and durable ledger custody. Forge's gate needs one acceptable clean review and a complete account of unresolved findings from all reporting reviewers. Ranger owns executing and recovering the review ladder.

## Next work and owners

| Work | Accountable owner and next action |
| --- | --- |
| [FOR-38 trusted Buildkite lane](https://linear.app/outfitter/issue/FOR-38) | Forge delivery owner prepares protected project capture, authenticated artifact collection, gate hooks and durable state. The operator completes OIDC/WIF credential delivery and queue restrictions, then qualifies isolation and the first live status under the selected service configuration. |
| [FOR-45 review adapters](https://linear.app/outfitter/issue/FOR-45) | Forge delivery owner moves collection behind the shared adapter contract before live consumer acceptance. Codex remains the first qualified source. |
| [FOR-39 required status](https://linear.app/outfitter/issue/FOR-39) | Forge delivery owner prepares repository enforcement after the trusted lane can produce the status. |
| [FOR-40 live consumer acceptance](https://linear.app/outfitter/issue/FOR-40) | Forge and Climb owners qualify the complete gate and consumer workflow after the lane, enforcement and review adapters are ready. |
| [ROPE-86 canary qualification](https://linear.app/outfitter/issue/ROPE-86) | Ropes owns approved publication. Forge owns a fresh public-registry consumer check before changing its production pilot pins. |

The FOR-38 configuration still needs the gate-only GitHub App and status context, collection credential delivery, review/hold/thread event routing, behavior while a refresh is pending, and handling of multiple PRs sharing one head. Matt selected OIDC/WIF for credential delivery in [OUT-498](https://linear.app/outfitter/issue/OUT-498). [OUT-499](https://linear.app/outfitter/issue/OUT-499) tracks the remaining queue restriction. The [configured-bot findings proposal](configured-bot-findings-proposal.md) also needs an owner decision. Use the [lane configuration plan](buildkite-lanes-plan.md#configuration-to-settle-before-launch) to prepare those choices.

Product repositories own task graphs and release policy. Existing Actions consumers keep their current integration until a replacement qualifies. The tokens shadow artifact trial and further loader/sandbox diagnosis remain parked. [FOR-19](https://linear.app/outfitter/issue/FOR-19) and [FOR-23](https://linear.app/outfitter/issue/FOR-23) retain later release and monorepo adoption work.

## Pilot evidence and recovery records

Use the README's [documentation index](../README.md#start-here) for current references and dated qualification records. [Pilot qualification](pilot-qualification.md), [session closeout](session-closeout.md), and the hosted-review qualification records preserve their original subjects and limits. Per-increment implementation history is retained in Git, merged PRs and the owning Linear issues.

The seven original operational records have a verified [machine-local archive](public-readiness.md#operational-record-preservation). Matt accepted its limited durability. Hosts, credentials and runtime health must be checked for the operation being qualified. [Legacy Forge retirement](legacy-forge.md) records the separate archived predecessor and preserved local worktree.
