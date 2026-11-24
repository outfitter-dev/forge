# Configured reporting bots qualification

Implementation and offline testing were authorized by Matt on November 24, 2026 under [FOR-38](https://linear.app/outfitter/issue/FOR-38). The adopted [contract amendment](automation-contract.md#evidence-earns-the-decision) permits configured source coverage and GitHub native thread resolution. Live trial approval, complete reporting-surface qualification and an independently qualified clean review remain prerequisites for Forge’s trusted lane.

## Selecting the candidate policy

The opt-in [`configured-reporters.candidate.json`](../examples/gate/configured-reporters.candidate.json) uses gate-policy schema 2 and `findingSources`. Its source set names the observed Codex, Devin, Cursor, Linear and GitHub Advanced Security account identities below. Each source declares all three supported GitHub surfaces, permitted format parsers and external coverage. The candidate’s `policyRevision` identifies immutable governing source `76cb6e3a9ba9d29a8a90d9075a0db850c04dbcde`, which contains the configured-reporters implementation, contract and candidate definitions. Forge derives `policyDigest` from the exact normalized configuration, including that governance reference, and retains both with the coverage observation. A supplied digest must match that normalization. The trial operator separately records and verifies the full protected policy file’s SHA-256. These identities distinguish the governing definitions, the configured finding scope and the complete policy file used in a run.

Pass the candidate’s protected absolute path to the ordinary `forge gate --policy` invocation. In this mode, `--review-evidence` is invalid input before collection. Finding coverage and native resolution come from the trusted collection. Independent clean-review attempts continue through the configured review adapters. The candidate marks every source’s external coverage unknown and lists GitHub code scanning as unqualified, so it cannot establish complete coverage until the live evidence is qualified. The committed `forge-gate.json` continues its existing supplied-global-ledger policy during that preparation.

## Read-only source observations

The following identities were read from GitHub’s authenticated REST API on November 24 against existing Forge pull requests. Each row records a stable numeric account ID and provider actor type. Logins identify the observation and may change. These reads supplied format evidence and granted no completeness claim.

| Reporter | Account ID | Actor type | Observed source and meaning |
| --- | --- | --- | --- |
| `chatgpt-codex-connector[bot]` | `199175422` | `Bot` | [PR 26 summary](https://github.com/outfitter-dev/forge/pull/26#issuecomment-6805023251) contains the `codex-review-state:v1` marker with code/security review states, commit SHAs and finding flags. |
| `devin-ai-integration[bot]` | `158243242` | `Bot` | [PR 82 review](https://github.com/outfitter-dev/forge/pull/82#pullrequestreview-6045016065) says it found three potential issues. Its three first native comments carry `devin-review-comment` metadata and the same submitted-review ID. |
| `cursor[bot]` | `206951365` | `Bot` | [PR 82 summary](https://github.com/outfitter-dev/forge/pull/82#issuecomment-7140839756) has a `CURSOR_SUMMARY` wrapper around prose. A [separate quota notice](https://github.com/outfitter-dev/forge/pull/82#issuecomment-7140841548) reports that Bugbot could not run. |
| `linear-code[bot]` | `222613912` | `Bot` | [PR 82 linkback](https://github.com/outfitter-dev/forge/pull/82#issuecomment-7140857004) identifies its `linear-linkback` marker. Older linkbacks can contain the full issue description and a `linear-review-link` section. |
| `github-advanced-security[bot]` | `62310815` | `Bot` | A native review-thread first comment on PR 84, comment `4685033896` and submitted review `6045477736`, reported on `a36dd07388b4b2e11f24c3b9a5b7412aa7c4b567`. Only actor and native-surface metadata were used to add this observed identity to the candidate. |

The installed `codex-summary-v1` finding classifier accepts an issue comment containing only the `codex-pull-request-review-summary` marker and one valid `codex-review-state:v1` marker, apart from whitespace. The structured flags can preserve adverse evidence even when surrounding prose makes the full report unsupported. The historical PR 26 comment has additional rendered prose and therefore leaves this scoped inventory unknown. The existing clean-review adapter separately parses its supported review summary. Independent review acceptance still requires the original head/base binding and accepted provenance. An old summary cannot gain a base binding from the current collection.

The installed `devin-review-v1` classifier recognizes Devin’s `1 potential issue.` and `N potential issues.` summaries as adverse evidence. The exact supported badge format requires the noun to agree with the count. The exact observed count and v4 badge, linking to the same repository and PR as the native review, are a recognized report format. A count alone cannot identify the reported findings. The adverse entry therefore remains open even when every visible thread is resolved. An eligible follow-up can explicitly address that entry while the original report remains visible. Unrecognized badge markup or extra prose leaves coverage unknown and preserves the positive adverse report. The current implementation supplies no Devin clean-summary acceptance or summary-to-thread clearance.

The installed `cursor-summary-v1` classifier accepts only the observed complete issue-comment quota notice, including its fixed usage-limit wording, dashboard link and UUID request ID. The marked `CURSOR_SUMMARY` prose remains unsupported and leaves coverage unknown. A recognized quota notice establishes that the message reports unavailability. It supplies no clean review.

The installed `linear-linkback-v1` classifier accepts the observed minimal issue-comment form `<!-- linear-linkback -->` followed by one `<p><a>` link to a Linear workspace issue whose displayed issue ID matches the URL. Additional issue-description prose, the older details form and a `linear-review-link` section remain unsupported. A qualified operational message establishes only its own classification. Bot identity, actor type, editor identity, surface and complete stable collection must also qualify.

The observation did not establish every delivery surface for any reporter. In particular, dashboards, check outputs, annotations and edits require their own supported collection or explicit qualified coverage. Readers must recheck actual current identities, formats and access before the live trial.

## Code scanning exposes a separate reporting surface

An authenticated read-only observation on November 24 found an open code-scanning alert on exact main commit `ea1618d9a93c8544365d26d64d3994560d1ad24d`. Detailed alert information remains in the access-controlled source. This record establishes the separate reporting surface that qualification must account for.

At that revision the three `Analyze` check runs were successful, reported zero annotations, and identified GitHub Actions App ID `15368`. Those observations do not account for the separate open alert. The App ID identifies the checks’ producer. It supplies no bot account ID or qualification for the alerts surface. A lookup for the guessed `github-code-scanning[bot]` username returned HTTP 404. The later native PR 84 observation verified the distinct `github-advanced-security[bot]` account above. Its candidate entry supports native thread collection and retains unknown external coverage. That observation does not establish coverage of the separate alerts API, so `github-code-scanning` remains in `unqualifiedSources`.

The existing alert remains source evidence to account for during live qualification. Its remediation or dismissal requires separate triage. The configured-bot inventory must keep external code-scanning coverage unknown until a supported complete alerts observation and its accepted provenance are qualified.

## Explicit follow-up evidence

The trusted adapter result contract can carry `followUpResolutions`. Each link names the accepted finding’s exact reporter, ID, original attempt and native reference, plus a distinct follow-up attempt, `fixed` or `dismissed` disposition and evidence reference. Only a stable normalized installed-adapter result can supply the link. Its follow-up attempt must satisfy that adapter’s configured reviewer, issuer, current head/base, completion and independence rules. The collector applies accepted links after the current native inventory, preserves the original adverse entry and publishes the result with the same ledger compare-and-swap.

In scoped schema 2 evidence, `resolutionReviews` can carry validated targeted attempts from later unselected adapters. The evaluator checks those attempts independently for explicit follow-up resolution while preserving the ordered clean-review selection in `agentReviews`. Native thread resolution cannot use these additional attempts. Legacy policies without `findingSources` reject this field.

`tests/review-follow-up.test.ts` exercises this capability with an injected trusted test adapter, including exact linkage and rejection of wrong issuer, foreign reviewer, duplicate attempt, original-attempt reuse, unavailable result and changed observations. The broader scoped CLI suite exercises collection, persistence and gate decisions over controlled HTTP. No installed real provider currently emits qualified explicit follow-up links. In the current production adapters, native thread resolution is the available resolution path for scoped thread findings. An adverse report outside a thread stays blocked until a provider’s explicit follow-up contract is qualified.

The evaluator independently requires a recorded finding ledger whose coverage matches the current repository, PR, head, base, collector identity and run as well as the policy revision, normalized digest and reporting accounts. Scoped completeness cannot satisfy the legacy global policy, and a changed source scope cannot borrow an earlier completeness claim. Native resolutions retain their accepted scope and are rechecked against the current authority. These checks apply to direct evaluator callers as well as `forge gate`.

## Native thread trial on Forge

On [PR 85](https://github.com/outfitter-dev/forge/pull/85), Forge source and base `40a7d20632c979e7b9148c83c54700059f024ded` evaluated head `20a6967b2c2f7655b7e07c958022171dbfe389e4` three times using an isolated ledger. The [Devin thread](https://github.com/outfitter-dev/forge/pull/85#discussion_r4685387387) kept its original finding identity. Resolving it removed the thread-specific blocker, and reopening it restored that blocker. The candidate remained ineligible in all three states. These were manual collections. Automated event delivery, external reporting coverage, independent review availability and production status publication still require qualification.

The same trial produced Devin’s singular submitted-review form. The original source reported unknown format. The [FOR-38 trial record](https://linear.app/outfitter/issue/FOR-38#comment-74eea39f-4b31-454d-85ad-2b07c3d76f09) identifies the original policy digest, receipt and individual collector runs.

## Live trial acceptance

The operator selects the installed source revision, policy revision and reporting scope from protected inputs. Record exact repository, PR, head/base, reporting account IDs and actor types, supported formats, editor identities and every collection reference. Qualify complete pagination and a stable second observation for review threads, submitted reviews and issue comments, with external reporting surfaces accounted for separately.

On a controlled Forge PR, demonstrate native open, resolved, reopened, outdated and missing threads, plus retained reports across head/base changes and source removal. Demonstrate adverse reports appearing only in submitted-review bodies and issue comments, unmatched adverse summaries, unsupported output and quota messages. A known clean review from an eligible independent provider must coexist with those cases without clearing their blockers. Show the accepted explicit follow-up path for an adverse report outside a thread.

The actual gate invocation must use collected finding evidence with protected ledger state. Supply no handwritten completeness claim or copied clean attempt. Read back same-head refresh, ledger persistence and the final GitHub status against the exact revision. A failed or ambiguous read, changed observation, unknown source or failed compare-and-swap must leave the gate blocked. Before enabling reporting, obtain the separate Forge pipeline, App, worker and credential approvals recorded on FOR-38.

After that approval, the operator can make one bounded collection against the approved controlled PR using the following command. Record the approved, merged Forge commit containing the reviewed repairs in the trial authorization. Use a protected checkout of that exact source, its pinned Bun version and the independently selected protected policy file. Record the file’s governing `findingSources.policyRevision` and full-file SHA-256 in the same authorization, then verify both before collection. The command requires `jq` and `shasum` for this readback. The environment variables also identify the approved PR, exact head/base and qualified receipt file. `FORGE_GITHUB_TOKEN` must already be delivered through the approved credential path. The command emits no token value. It can return a blocked result while any candidate coverage remains unknown.

```sh
set -eu
umask 077
: "${FORGE_TRIAL_SOURCE:?approved full Forge commit SHA required}"
forge_trial_install="/opt/forge/$FORGE_TRIAL_SOURCE"
test "$(git -C "$forge_trial_install" rev-parse HEAD)" = "$FORGE_TRIAL_SOURCE" || exit 2
test "$(bun --version)" = "$(cat "$forge_trial_install/.bun-version")" || exit 2
: "${FORGE_TRIAL_PR:?approved controlled PR number required}"
: "${FORGE_TRIAL_HEAD:?exact approved head SHA required}"
: "${FORGE_TRIAL_BASE:?exact approved base SHA required}"
: "${FORGE_TRIAL_POLICY:?protected qualified policy path required}"
: "${FORGE_TRIAL_POLICY_REVISION:?approved governing policy source revision required}"
: "${FORGE_TRIAL_POLICY_SHA256:?approved full policy file SHA-256 required}"
: "${FORGE_TRIAL_RECEIPT:?qualified receipt path required}"
test "$(jq -er '.findingSources.policyRevision' "$FORGE_TRIAL_POLICY")" = "$FORGE_TRIAL_POLICY_REVISION" || exit 2
forge_trial_policy_sha256="$(shasum -a 256 "$FORGE_TRIAL_POLICY")"
forge_trial_policy_sha256="${forge_trial_policy_sha256%% *}"
test "$forge_trial_policy_sha256" = "$FORGE_TRIAL_POLICY_SHA256" || exit 2
forge_trial_run="$(mktemp -d)"
mkdir "$forge_trial_run/work"
cd "$forge_trial_run/work"
bun "$forge_trial_install/src/forge-cli.ts" gate \
  --repository outfitter-dev/forge --pull-request "$FORGE_TRIAL_PR" \
  --policy "$FORGE_TRIAL_POLICY" --state "$forge_trial_run/state" \
  --run-id for-38-controlled-review-policy \
  --expected-head "$FORGE_TRIAL_HEAD" --expected-base "$FORGE_TRIAL_BASE" \
  --receipt "$FORGE_TRIAL_RECEIPT" --output-version 2 \
  > "$forge_trial_run/result.json"
```

This invocation performs one collection with the CLI’s bounded pagination and request deadlines. Keep the result and protected ledger for readback and the later same-head cases. Successful local collection still needs separate live status publication and GitHub readback before the trusted lane qualifies.
