# Public source readiness

[FOR-25](https://linear.app/outfitter/issue/FOR-25) prepares Forge for public source reuse. Matt selected that direction on November 11, 2026, explicitly accepted leaving Git history, PR discussions and Actions logs as-is, and chose MIT. Repository metadata at the audited baseline still reports **private**; this preparation does not change visibility, settings, access, workers or package publication. A later visibility change requires separate explicit authorization after reviewable preparation lands.

`package.json` remains `private: true` and now declares MIT. The LICENSE follows the existing [Skillset copyright convention](https://github.com/outfitter-dev/skillset/blob/main/LICENSE), with 2026 Matt Galligan for Forge. Source licensing does not qualify a public adapter, package release or consumer migration.

## Audit scope and findings

The November 11 baseline is `ba30cb941ae8dfd483508c1c8cb918a3dbbe8bd0`. Origin was fetched, including all available PR heads 1–23 into a separate local audit-ref namespace; remote branch enumeration reported only `main`. Complete reachable blob contents and commit/tag metadata were scanned: **69 commits, 183 unique blobs, 1,233,502 bytes**, plus the tracked working tree. No matches were found for the credential patterns below. Repeat the scan on the final candidate and immediately before any visibility change; these counts describe the baseline, not later commits.

| Surface | Collected evidence | Finding and limit |
| --- | --- | --- |
| PRs 1–23 | 22 PR titles/bodies, 33 review records, 18 inline review comments including diff hunks, 190 conversation comments; paginated current REST representations, 289,524 content bytes | No listed credential-pattern matches. PR #3 returned 404 on all four endpoints and has no pull head; unused/deleted/inaccessible cannot be distinguished. Previous edits/deleted text, attachments, external reviewer UIs and linked private records were not independently recovered. |
| Actions history | All **126** currently listed runs, each attempt 1, downloaded as **350** log entries; no failed download or scan | No listed credential-pattern matches. Logs expose source/repository/branch identities, dependency/test names, hosted-runner paths, setup diagnostics and artifact references. Deleted or no-longer-listed runs cannot be recovered by this enumeration. |
| Workflow artifacts | Both listed non-expired SARIF artifacts from [run 42907084256](https://github.com/outfitter-dev/forge/actions/runs/42907084256), downloaded and scanned without execution/extraction to the checkout | No listed credential-pattern matches. Artifact expiry was reported as February 8, 2027. SARIF includes source/analysis identities; no arbitrary artifact producer authenticity is inferred. |
| Actions caches | **24** metadata entries, 467,347,751 bytes: 21 CodeQL database caches and 3 Bun caches | **Contents uninspected.** No supported archive download was used and no workflow was triggered to restore them. Treat possible historical source/dependency/analysis content as an unresolved exposure limit; keys/metadata do not establish sanitization. |
| Other repository surfaces | No releases, deployments, environments or repository webhooks returned; wiki and Discussions disabled | This does not inventory organization-wide integrations, deleted assets, external services, local private receipts or all security-feature records. No package was published by this preparation. |

Discussion context includes trusted-host topology, token custody/lifetime references without values, review/provider limitations, private repository/Linear links and quota failures. [PR #15’s bot summary](https://github.com/outfitter-dev/forge/pull/15#issuecomment-6781963204) repeats a Rex pane identifier. Historical commits contain machine paths, state/secret-location references, host/pane/process/container identities and service/actor identifiers. These are exposure to acknowledge, not credentials found by this scan. Matt’s retention decision preserves these records; current-tree sanitization cannot remove them from history, PR diffs/discussions, caches or retained logs. An actual credential or other material unsuitable exposure discovered later must stop publication preparation and be reported privately by location, without its value.

GitHub documents that [Actions history and logs become publicly visible](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility#making-a-repository-public). Its [cache guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) warns that fork PRs may access base-branch caches. Preserve this distinction when assessing cached historical data; no cache deletion, history rewrite or PR/log edit is authorized here.

### Credential-pattern coverage

The exact Python regular expressions used across reachable Git objects, current PR payload text, retained log entries and SARIF bytes were:

```json
{
  "github-token": "(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})",
  "buildkite-token": "(?<![A-Za-z0-9])(?:bkua|bkra|bkuc|bkac)_[A-Za-z0-9_-]{20,}",
  "npm-token": "(?<![A-Za-z0-9])npm_[A-Za-z0-9]{20,}",
  "slack-token": "xox[baprs]-[A-Za-z0-9-]{16,}",
  "openai-style-token": "(?<![A-Za-z0-9])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}",
  "private-key-block": "-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----",
  "aws-access-key-id": "(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])",
  "google-api-key": "AIza[A-Za-z0-9_-]{35}",
  "jwt-shaped": "(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}",
  "credential-url": "https?://[^\\s/:@]{1,80}:[^\\s/@]{8,}@[A-Za-z0-9.-]+"
}
```

These are bounded lexical checks, not proof of absence. Unknown formats, arbitrary high-entropy secrets, encoded/encrypted values, masked output, deleted/unreachable objects, uncollected prior edits and inaccessible/expired remote evidence can evade them. No secret values are printed in scan results. Private receipts retain exact enumerations, request outcomes, content hashes and match locations outside Git; no raw logs or transcripts are committed here.

## Repository settings: observations and proposals

Read-only API observations at the baseline:

| Setting | Observed state | Proposed follow-up, not applied |
| --- | --- | --- |
| Source visibility / package | Repository private; `package.json private: true`; no pre-existing license | MIT is now recorded in source; retain package publication guard. Visibility remains a separate action. |
| Main protection | Branch reports `protected: false`; rulesets and effective main rules empty; classic protection endpoint 404 | Before public contribution/adoption, explicitly select required CI/security checks, PR review and resolved-thread protections, preserving exact-head review practice. No bypass or setting change here. |
| Actions workflow defaults | Enabled, all actions allowed; SHA pinning not required globally; default token permission **write**; workflow PR approvals **enabled** | Prefer default read-only and disable workflow PR approvals unless a concrete operation separately needs them. Keep reviewed SHA pins and explicit per-job permissions. |
| Forge CI source | `pull_request` and main `push`; `contents: read`, checkout credential persistence disabled, pinned actions, hosted Ubuntu, frozen dependencies and offline suite; no secret references | Preserve these properties; no `pull_request_target` or privileged worker execution is added. PR workflow/dependency changes still require scrutiny. |
| Fork contributor approval | Public-fork approval endpoint rejects this private repository; private-fork settings endpoint 404; private forking currently disabled | Public effective approval policy is **unverified**. Explicitly choose approval for outside-collaborator workflows and re-read effective org/repo policy before accepting such runs. [GitHub approval guidance](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks) applies; no assumption that today's private setting protects tomorrow's public forks. |
| Repository Actions secrets / sharing | Zero repository secret names; zero environments; Actions sharing `none` | Not proof that organization secrets, integration credentials or operator accounts do not exist. Public source should not need new private-source credentials. |
| Security features | Code security, secret scanning, push protection, non-provider patterns and validity checks enabled; Dependabot security updates disabled | Reassess desired public security configuration separately; enabled scanning is not a clean-alert attestation or absence proof. |

AGENTS.md contains no private-repository assumption requiring change. The automation contract and provider policy remain unchanged. FOR-26 separately owns the optional-provider/versioned-evidence work and FOR-9 narrowing; the earlier hold is superseded, no live provider qualification is authorized, and FOR-25 changes no review policy. Buildkite host is explicit configuration, with Studio one historical option; this does not implement FOR-8 host/lifecycle changes. The tokens artifact trial and all loader/sandbox continuation are parked.

## Operational record preservation

The accepted destination is the private `outfitter-dev/agentic-ci-pilot`, proposed directory **`docs/forge-operational-records/2026-11-11/`**. Read-only inspection verified the repository private and no existing directory collision. Preserve complete originals from Forge `ba30cb9`, not rewritten reconstructions, to retain historical context and exact hashes:

| Forge source | Private destination basename | Forge remainder after verified preservation |
| --- | --- | --- |
| `docs/session-closeout.md` | `session-closeout.md` | Short dated pilot/design summary and immutable private record link |
| `docs/pilot-qualification.md` | `pilot-qualification.md` | Six-gate/revision-bound/unprivileged-execution findings and immutable private evidence link |
| `docs/handoff.md` | `handoff.md` | General scope, operation boundaries, public-source direction; replace established-setup/local recovery sections |
| `docs/worker-lifecycle-plan.md` | `worker-lifecycle-plan.md` | Host-configurable lifecycle/capacity/preservation contract without one-machine locations |
| `docs/queue-refresh-qualification.md` | `queue-refresh-qualification.md` | Dated trigger-budget/partial-qualification findings without pane/process identities |
| `docs/devin-findings-discovery.md` | `devin-findings-discovery.md` | Supported-status versus findings limits and current separate policy ownership without account identifiers |
| `docs/legacy-forge.md` | `legacy-forge.md` | Archive/repository distinction without local checkout paths |

**Preservation is not yet committed.** The local immutable bundle and per-file SHA256 inventory are prepared; no destination write or Forge operational-record removal has occurred. The pilot has an active event webhook and enforced ALLGREEN merge queue plus six Buildkite statuses, so its ordinary docs PR/merge would invoke live automation. The preparation release excludes that work and settings/bypass changes. Parent must resolve a bounded archive-PR execution route or confirm another inactive private home before this sequence can finish. This is a concrete destination-delivery blocker, not a reason to repeat host selection or resume the parked tokens trial.

Once an authorized route exists: open a focused destination docs PR, run its applicable offline checks/review, preserve under its actual rules, and verify the merged destination commit and each original byte hash. Only then replace Forge’s operational specifics with summaries and immutable private links. Keep original state/runtime/secrets/receipts untouched. Until that proof exists, the identifier-removal acceptance criterion remains deliberately unmet; source records remain preserved here. Re-run the explicit identifier search and all checks after replacement.

## Distribution work rescope proposal

Proposed **FOR-6 title:** “Qualify immutable public Forge source invocation.” Replace the private cross-owner credential comparison/rotation criteria with one consumer that selects an approved repository/full commit and Bun runtime, verifies the fetched commit before execution, invokes the existing operation with explicit harmless facts/policy and records expected success/blocked/invalid outcomes. A deliberately wrong configured pin must fail before invocation, with no mutable fallback. Demonstrate anonymous public-source fetch only after visibility is actually changed; before that, report the test held. Keep source identity, policy authority, cleanup and negative evidence explicit. No new package, generic distribution helper, public adapter, consumer migration or live qualification is released by rescoping.

Retain the November 10 private-at-the-time analysis/results as superseded historical evidence. Their consumer-token denials and trusted-host results are not reclassified as public or cross-owner qualification. Public source removes the need for cross-owner source-read credentials; it does not grant status/release/merge rights, resolve authenticated collection, or make job-level reusable workflows interchangeable with step checkout.

For **FOR-19**, remove private-source transport as an implementation prerequisite once public, retain immutable operation/adapter/runtime binding and concrete consumer qualification, and keep product policy explicit. Existing offline operations remain useful; no additional pure helper expansion is needed for visibility. For **FOR-23**, future monorepo wiring can pin public Forge through its qualified thin adapter without a Forge-read secret; FOR-20 health, FOR-21 disposition, actual adapter checks and product-owned MONO-83 artifact decisions remain. Cross-repo implementation/adoption is separately released; the parked artifact trial is not resumed. These are proposed issue corrections, not edits claiming either issue complete.

## Remaining completion evidence

Resolve the archive delivery blocker, verify private preservation before source sanitization, repeat candidate-head current/history and identifier scans, run frozen/full Forge checks and independent latest-head review, and retain the actual coverage gaps above. The repository must remain private throughout FOR-25. Matt’s history-retention and MIT choices are settled; no new license, history or broad host-selection question is pending. A final visibility change, settings changes and any acceptance of additional unsuitable exposure remain separate explicit decisions.
