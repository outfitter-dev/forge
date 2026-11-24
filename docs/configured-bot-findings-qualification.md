# Configured reporting bots qualification

Implementation and offline testing were authorized by Matt on November 24, 2026 under [FOR-38](https://linear.app/outfitter/issue/FOR-38). The adopted [contract amendment](automation-contract.md#evidence-earns-the-decision) permits configured source coverage and GitHub native thread resolution. Live trial approval, complete reporting-surface qualification and an independently qualified clean review remain prerequisites for Forge’s trusted lane.

## Selecting the candidate policy

The opt-in [`configured-reporters.candidate.json`](../examples/gate/configured-reporters.candidate.json) uses gate-policy schema 2 and `findingSources`. Its source set names the observed Codex, Devin, Cursor and Linear account identities below. Each source declares all three supported GitHub surfaces, permitted format parsers and external coverage. `policyRevision` identifies the governing source revision; Forge derives `policyDigest` from the normalized scope and retains both with the coverage observation. A supplied digest must match that normalization.

Pass the candidate’s protected absolute path to the ordinary `forge gate --policy` invocation. In this mode, `--review-evidence` is invalid input before collection. Finding coverage and native resolution come from the trusted collection. Independent clean-review attempts continue through the configured review adapters. The candidate marks every source’s external coverage unknown and lists GitHub code scanning as unqualified, so it cannot establish complete coverage until the live evidence is qualified. The committed `forge-gate.json` continues its existing supplied-global-ledger policy during that preparation.

## Read-only source observations

The following identities were read from GitHub’s authenticated REST API on November 24 against existing Forge pull requests. Each row records a stable numeric account ID and provider actor type. Logins identify the observation and may change. These reads supplied format evidence and granted no completeness claim.

| Reporter | Account ID | Actor type | Observed source and meaning |
| --- | --- | --- | --- |
| `chatgpt-codex-connector[bot]` | `199175422` | `Bot` | [PR 26 summary](https://github.com/outfitter-dev/forge/pull/26#issuecomment-6805023251) contains the `codex-review-state:v1` marker with code/security review states, commit SHAs and finding flags. |
| `devin-ai-integration[bot]` | `158243242` | `Bot` | [PR 82 review](https://github.com/outfitter-dev/forge/pull/82#pullrequestreview-6045016065) says it found three potential issues. Its three first native comments carry `devin-review-comment` metadata and the same submitted-review ID. |
| `cursor[bot]` | `206951365` | `Bot` | [PR 82 summary](https://github.com/outfitter-dev/forge/pull/82#issuecomment-7140839756) has a `CURSOR_SUMMARY` wrapper around prose. A [separate quota notice](https://github.com/outfitter-dev/forge/pull/82#issuecomment-7140841548) reports that Bugbot could not run. |
| `linear-code[bot]` | `222613912` | `Bot` | [PR 82 linkback](https://github.com/outfitter-dev/forge/pull/82#issuecomment-7140857004) identifies its `linear-linkback` marker. Older linkbacks can contain the full issue description and a `linear-review-link` section. |

The existing Codex summary parser can determine explicit finding flags and completion for its supported marker. Independent review acceptance still requires the original head/base binding and accepted provenance. An old summary cannot gain a base binding from the current collection.

The Devin summary’s count and badge alone establish an adverse report. Native review IDs and metadata can support a separately tested explicit mapping to its declared native finding set. If the collector cannot prove that mapping, it retains the adverse report even when all visible threads are resolved. A mapped thread remains subject to native identity, complete collection and retained-history rules.

Cursor’s marked prose summary supplies no structured complete finding inventory. The quota notice establishes an unavailable attempt. Qualifying one known operational message establishes only that message’s classification. A source’s unsupported output leaves coverage unknown. The Linear linkback is a separate observed bot source that requires explicit policy treatment before the collector can declare complete coverage in a PR containing it.

The observation did not establish every delivery surface for any reporter. In particular, dashboards, check outputs, annotations and edits require their own supported collection or explicit qualified coverage. Readers must recheck actual current identities, formats and access before the live trial.

## Code scanning exposes a separate reporting surface

An authenticated read-only observation on November 24 found an open code-scanning alert on exact main commit `ea1618d9a93c8544365d26d64d3994560d1ad24d`. Detailed alert information remains in the access-controlled source. This record establishes the separate reporting surface that qualification must account for.

At that revision the three `Analyze` check runs were successful, reported zero annotations, and identified GitHub Actions App ID `15368`. Those observations do not account for the separate open alert. The App ID identifies the checks’ producer. It supplies no bot account ID or qualification for the alerts surface. A lookup for the guessed `github-code-scanning[bot]` username returned HTTP 404, so this record adopts no guessed reporter identity.

The existing alert remains source evidence to account for during live qualification. Its remediation or dismissal requires separate triage. The configured-bot inventory must keep external code-scanning coverage unknown until a supported complete alerts observation and its accepted provenance are qualified.

## Live trial acceptance

The operator selects the installed source revision, policy revision and reporting scope from protected inputs. Record exact repository, PR, head/base, reporting account IDs and actor types, supported formats, editor identities and every collection reference. Qualify complete pagination and a stable second observation for review threads, submitted reviews and issue comments, with external reporting surfaces accounted for separately.

On a controlled Forge PR, demonstrate native open, resolved, reopened, outdated and missing threads, plus retained reports across head/base changes and source removal. Demonstrate adverse reports appearing only in submitted-review bodies and issue comments, unmatched adverse summaries, unsupported output and quota messages. A known clean review from an eligible independent provider must coexist with those cases without clearing their blockers. Show the accepted explicit follow-up path for an adverse report outside a thread.

The actual gate invocation must use collected finding evidence with protected ledger state. Supply no handwritten completeness claim or copied clean attempt. Read back same-head refresh, ledger persistence and the final GitHub status against the exact revision. A failed or ambiguous read, changed observation, unknown source or failed compare-and-swap must leave the gate blocked. Before enabling reporting, obtain the separate Forge pipeline, App, worker and credential approvals recorded on FOR-38.
