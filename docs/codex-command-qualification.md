# Codex normal-command qualification

The November 13, 2026 bounded local qualification established that the normal `forge gate` command accepts the current hosted Codex review under the adopted Forge attestation, retains prior findings, and blocks unknown finding coverage. Independent audit of the actual source inventories, executable/configuration hashes, receipts and stored state completed clean with no open P0/P1/P2 findings. Production Buildkite lane adoption remains owned by FOR-38. [FOR-37](https://linear.app/outfitter/issue/FOR-37)

## Exact subject and invocation

| Input | Observed value |
| --- | --- |
| Repository and pull request | `outfitter-dev/forge`, PR #50 |
| Reviewed head | `7b45ef53e9dff673984c89d2355b3c116c5cfd96` |
| Applicable base | `338081806db285b045239f47529d4b60905dacc1` |
| Clean trusted Forge source | `338081806db285b045239f47529d4b60905dacc1` |
| Runtime | Bun `1.4.4` |
| Local collector | `for37-local-command-qualification` |
| Final runtime/configuration fingerprint | `a6c4afed176e26923f39a07ec8a8e3220394f5b3c71a6c73953da2677abed1e5` |

The private qualification wrapper invoked `bun src/forge-cli.ts gate` from the exact clean trusted source. The temporary policy and state lived outside the proposed checkout. The wrapper obtained an existing `gh` credential in memory and supplied it only through `FORGE_GITHUB_TOKEN`. Each child produced one evaluated JSON result, exit 1 and empty stderr. The retained descriptor hashes the wrapper, resolution helper, independent review report, review instructions and selected settings. The collector name and fingerprint describe this actual local invocation.

The policy used the adopted `codex-github` entry, verified Bot account `199175422`, explicit independence statement, 900-second wait and `supplied-global-ledger`. A separate eligible local reviewer represented the actual clean-context independent review used for the finding follow-up below. The policy supplied no verification receipts or ladder exhaustion claim. [Adopted entry](hosted-reviewer-attestations.md#adopted-policy-entry)

## Review and revision binding

| Event | UTC time on November 13, 2026 |
| --- | --- |
| Effective persisted snapshot for repaired head/base | `13:17:09` |
| Exact `@codex review` request, comment `6854078872` | `13:17:37` |
| Current-head completed summary update, comment `6854084977` | `13:18:36` |
| Final authoritative CLI observation | `13:26:19` |
| Source-inventory bracket | `13:25:25.059` through `13:26:29.947` |

The initial unedited summary had an unknown editor and correctly yielded `editor-unverified`. The completed summary's author and editor both had numeric ID `199175422` and type `Bot`. Its code-review section named the exact head, reported completion and both adverse flags false. The all-null security section was inactive. Collection retained the earlier persisted head/base snapshot, and the summary update fell strictly after that snapshot and before the final served observation. [Codex summary](https://github.com/outfitter-dev/forge/pull/50#issuecomment-6854084977)

## Findings and source coverage

Devin finding `4563684891`, thread `PRRT_kwDOVpv5YM63GmYL`, identified stale guidance-qualification status. The repair changed the command documentation. The finding's original `devin-github` identity, reporting review `5891596039`, native reference and origin remained in the local persisted ledger across the new head. A clean hosted Codex review and a resolved GitHub thread left that stored entry blocking because this policy had no qualified Devin-native resolution issuer. [Original finding and repair reply](https://github.com/outfitter-dev/forge/pull/50#discussion_r4563684891)

The actual independent local reviewer explicitly marked this finding fixed at the exact final head/base. The trusted local collector represented that review as a separate completed attempt, retaining its clean-context launch, instructions/report digests and owner-only report reference. The existing store API accepted an explicit `follow-up-review` resolution bound to that local attempt and its `fixed` disposition, preserving the original finding. Resolution CAS retained `recorded: false`. Current global completeness was attested separately. A proposed attribution to the generic clean hosted review was corrected during audit before any resolution was applied.

The local attempt's `startedAt` records the collector wait origin at `13:17:09`, following the attempt contract. The exact reviewer launch timestamp was unavailable. `launch: "author-subagent"` and `context: "none"` derive from the actual independent subagent invocation with `fork_turns: "none"`. The local review is qualification evidence for this subject, and supplies no Ranger production-reviewer adoption. [Attempt and resolution contract](evidence-evaluator.md#attempts)

The manual trusted coverage audit included every paginated GitHub issue comment, submitted review, inline comment and native thread resolution, plus the owned independent local review. Earlier inventories retained the original finding and preceding head. The final before/after inventories matched exactly across subject, bodies, identities, timestamps, resolutions and local report. They contained four issue comments, two submitted reviews, two inline comments, one resolved thread and one local report. The sole reported issue was the retained finding described above. The coverage claim is bounded by those visible sources and retained history. It establishes no ability to reconstruct an unseen report deleted before collection.

## Normal-command results

Four control state directories were cloned from the same canonical entry after the explicit resolution, preserving the snapshot, original finding and resolution. A final observation used the authoritative state. Every final observation fell within the matching source-inventory bracket.

| Case | `agent-review` result | Accepted clean reviews |
| --- | --- | --- |
| Accepted Codex attestation, absent supplied history | Failure with `findings-unknown` | Hosted Codex is credible, while the required history and local follow-up attempt are absent. |
| Accepted Codex attestation, explicitly unknown supplied history | Failure with `findings-unknown` | Hosted Codex is credible, while the supplied history remains unknown and omits the local attempt. |
| Null Codex attestation, complete supplied history and local follow-up | Success | Local review supplies the fallback. Hosted Codex remains `context: "unknown"` and is excluded from `satisfiedBy`. |
| Accepted Codex attestation, complete supplied history and local follow-up | Success | Hosted Codex and the distinct local review both appear in `satisfiedBy`. |
| Final authoritative observation with accepted complete history | Success | The same two attempts qualify and the original finding retains its accepted local follow-up resolution. |

The whole command remained `eligible: false` with exit 1 in every case. Lint, test and build lacked verification receipts, and the pull request was draft during this historical window. These observations establish review qualification and failure handling. PR #50 subsequently passed independent review and hosted CI before its authorized merge as `a2546e51cf4813386421c7e8d1fd795f06803264`.

## Retained evidence and next owner

FOR-37 retains the owner-only evidence location containing raw inventories, exact policies and descriptors, actual wrappers, normal-command results, canonical before/after resolution records, global history, local report/instructions and independent coverage audit. Raw runtime evidence stays outside Git. [FOR-37 evidence record](https://linear.app/outfitter/issue/FOR-37)

FOR-38 owns the production issuer/runtime identities, trusted installed source, durable ledger and authenticated collection/resolution inputs, root `forge-gate.json`, Buildkite execution and status publication. FOR-39 owns required-status enforcement, and FOR-40 owns the posted-status and Climb consumer qualification. Those consumers must collect fresh evidence for their actual subject and authenticate their actual inputs. The local observation establishes a completed Forge-scoped Codex qualification and the selected entry it can consume. [FOR-38](https://linear.app/outfitter/issue/FOR-38), [FOR-39](https://linear.app/outfitter/issue/FOR-39), [FOR-40](https://linear.app/outfitter/issue/FOR-40)
