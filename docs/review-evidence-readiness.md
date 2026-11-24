# Review evidence readiness

Qualification record for FOR-52, November 24, 2026, against Forge `bd873454a67db313e51491611ab8e548ea150767`. The trusted lane needs both a qualified clean review of the exact head/base and a complete account of reported findings before its agent-review gate can pass. The current `forge-gate.json` adopts the hosted Codex adapter with `findingHistory: "supplied-global-ledger"`.

## What the current implementation establishes

The adapter can collect Codex's supported summary and native review threads. A trusted caller can supply a global finding ledger through `--review-evidence`. `recorded: true` is that caller's completeness claim. Parsing the file and storing it do not authenticate its writer or establish which reporting surfaces it covered. The lane must establish that authority and coverage before supplying the file.

Existing CLI tests exercise the accepted contract under the committed policy and its equivalent test policies. Run them from a bootstrapped checkout with the pinned Bun version.

```sh
bun test tests/forge-gate-policy-file.test.ts tests/gate-finding-history.test.ts tests/forge-gate-codex.test.ts
```

The November 24 run passed all 44 tests with 2,610 assertions. They establish that a supplied complete clean inventory can permit the agent-review gate, an unresolved finding from another reviewer remains blocking, changes to supplied history cannot clear a persisted blocker, and a previously complete inventory cannot replace the current run's missing coverage. A clean Codex observation with no supplied ledger reports `findings-unknown` under the committed policy.

## Live source observations

Read-only GitHub observations on November 24 covered [Forge PR 75](https://github.com/outfitter-dev/forge/pull/75) at head `3571ac6b2bef436f144799b9cac7878df7ee9c0f` and base `e5f1571acb3577dae4b60c3eb3a4817fba838e1b`. GitHub reported no next page for the reviews, issue comments, review threads or comments within the single thread.

| Surface | Observation | Evidence limit |
| --- | --- | --- |
| Submitted review | Devin bot account `158243242`, review `6030580954`, reported one potential issue on earlier head `007d61b72c31b2db24b6463123a954c1792b4035` | The installed Codex adapter supplies no Devin report-to-finding mapping. |
| Native thread | [Thread `PRRT_kwDOVpv5YM67GZLo`](https://github.com/outfitter-dev/forge/pull/75#discussion_r4672924367) was resolved; its first comment was from the same Devin account | Native resolution establishes GitHub's thread state. It does not by itself account for every adverse report in a summary or external provider dashboard. |
| Issue comments | Cursor bot account `206951365` posted a summary and a usage-limit notice | This account has no installed review adapter or adopted finding-source classifier. The notice cannot supply a completed clean review. |
| Codex | No adopted Codex summary was present | A green hosted review status from another provider cannot supply a Codex review or complete inventory. |

The earlier [PR 26 summary](https://github.com/outfitter-dev/forge/pull/26#issuecomment-6805023251), from adopted Codex account `199175422`, remained readable. It reported a completed code review without findings at head `41065355ea5802abcf635454bfc49506aac9241d`; the security section was inactive. A real `forge gate` invocation used the committed policy, that head, base `aa036c3ecee8685c33340c3a33d1687bb66caeac`, a fresh isolated state directory, and no receipt or supplied review-evidence file.

That run exited one. The adapter parsed the clean summary and reported `summary-unbound`, because its historical base binding was unavailable in the fresh ledger. The agent-review gate also reported `findings-unknown`. Other gates lacked verification evidence and reflected the PR's current closed state. This run establishes read-only collection and refusal behavior. It supplies no current passing PR qualification. A newly observed snapshot cannot retroactively bind the base of an older review.

## Decision before a live green gate

The existing contract permits an independently established global ledger, but the repository currently provides no producer that can authenticate a complete inventory spanning the observed reporters and surfaces. The operator must identify and qualify such a producer before using `recorded: true`. An empty handwritten file would leave the required coverage unproven.

Matt owns the proposed alternative in [configured-bot findings](configured-bot-findings-proposal.md). The smallest decision is whether Forge may establish completeness for a specifically configured, qualified set of reporters and surfaces, with the proposed retention and resolution rules. Confirmation must identify the source scope and native-resolution authority. An implementation then needs actual format fixtures, stable identities, pagination and edit handling, retained adverse history, and live surface coverage before its policy can be adopted. Unqualified reporters and unsupported formats keep completeness unknown.

The delivery owner can continue protected runner capture, trusted collection and negative-path qualification while this decision is pending. Ranger owns executing and recovering the review ladder. The Forge policy owner selects acceptable evidence; the trusted lane owns authenticating its source. See the [automation contract](automation-contract.md#evidence-earns-the-decision), [ledger contract](review-ledger-store.md#finding-history-and-compatibility), and [current policy](../forge-gate.json).
