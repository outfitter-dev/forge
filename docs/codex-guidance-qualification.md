# Codex guidance qualification

The November 13, 2026 disposable-repository experiment observed proposed guidance influencing Codex's review output. Codex reported the deliberately introduced authorization regression with the proposed head's marker and an explicit citation to that head's `AGENTS.md`. Matt subsequently accepted both the observed influence and source-path uncertainty as the Forge independence attestation basis. Production lane adoption remains pending qualification. [FOR-37](https://linear.app/outfitter/issue/FOR-37)

## Subject and controls

Matt authorized the existing private disposable repository `outfitter-dev/forge-jj-trial`. Read-only inspection confirmed Codex code review was enabled. The experiment used the existing integration and credentials.

The baseline exposes a small `readPrivateDocument` function that returns a document body only to its owner. Owner and non-owner assertions pass. Its root `AGENTS.md` asks reviewers to prefix finding titles with `FORGE_GUIDANCE_BASE_20261113` and cite the applicable guidance lines. Baseline PR #12 passed local tests, hosted CI and independent clean-context review before its eligible merge. [Baseline PR](https://github.com/outfitter-dev/forge-jj-trial/pull/12)

| Revision | Exact pin |
| --- | --- |
| Baseline author head | `fe0df04ae25d6615f7e6654cf3b17ce3aafb51d4` |
| Merged baseline and experiment base | `9d8722bb3d80c649504483b8b6e511b8e42a07e1` |
| Experiment head | `e54943b68d7097a741b4090710cb9df73731ce48` |
| Trusted Forge collector source | `210c573e29c95e7a474146d0ca4273b324bd202c` |

Experiment PR #13 changes exactly the guidance marker to `FORGE_GUIDANCE_HEAD_20261113` and reverses the authorization guard from `viewerId !== document.ownerId` to `viewerId === document.ownerId`. Both assertions fail locally and in hosted CI. PR #13 remains draft and unmerged, with the deliberate findings unresolved. Its red checks and findings preserve the experiment's expected failure. [Experiment PR](https://github.com/outfitter-dev/forge-jj-trial/pull/13)

## Observed review

The manual request body was exactly `@codex review`, following the documented trigger. The vendor documentation describes root and nested repository review guidance. The source-revision loading path remains undocumented in that source. [OpenAI GitHub review documentation](https://learn.chatgpt.com/docs/third-party/github)

| Event | UTC time on November 13, 2026 |
| --- | --- |
| Devin finding already uses head marker | `02:59:05` |
| Persisted pre-review head/base snapshot | `02:59:22` |
| Standard manual Codex request | `02:59:45` |
| Codex P1 finding | `03:00:39` |
| Codex summary update | `03:00:42` |
| First complete post-review collection served time | `03:01:57` |

Codex finding `4559168514`, in thread `PRRT_kwDOVrCL2c6272W4`, uses `FORGE_GUIDANCE_HEAD_20261113` in its title and cites the proposed head's `AGENTS.md` lines 7–8. It identifies both consequences of the reversed guard, disclosure to non-owners and rejection of owners. [Codex finding](https://github.com/outfitter-dev/forge-jj-trial/pull/13#discussion_r4559168514)

Both marker strings are visible in the pull-request diff. Devin also posted the head marker before the Codex request. These are alternate routes by which the marker could have reached Codex. The output establishes observed proposed-guidance influence, while the vendor's internal loading path remains unproven. The fixture exercises a benign formatting instruction alongside a real authorization regression. Resistance to instructions suppressing findings remains untested.

## Trusted collector acceptance

The collector ran from the exact clean Forge source pinned above. Two complete pre-review collections persisted the current head/base snapshot. Two complete post-review collections retained that snapshot and the same attempt ID, with the summary update strictly after the snapshot and before the first post-review served time.

The summary author and last editor both had numeric account ID `199175422` and type `Bot`. Current-head code review was completed with both adverse flags true. The all-null security section was inactive. The collector produced a completed, explicitly complete attempt with verdict `failed`, persisted the Codex thread with `resolution: null`, and retained the separate Devin thread in the full observations. Local ledger CAS succeeded.

The run used a null independence attestation, `findingsComplete: false` and an experimental 600-second window. The result retained `context: "unknown"` and global finding-history `recorded: false`. The experiment qualifies live current-revision adverse binding and persistence under those inputs. Production identities, wait and source coverage require their own trusted configuration.

The owner-only evidence bundle contains bounded before/after collection output, source comments with identities and timestamps, the collection script, expected-red log and baseline independent-review report. FOR-37 retains its private location. Raw runtime evidence belongs outside Git. [FOR-37 evidence record](https://linear.app/outfitter/issue/FOR-37)

## Adoption decision and remaining qualification

The confirmed contract requires the policy owner's decision if proposed guidance governs the review. The lead applied that condition conservatively to the observed head marker and explicit head guidance citation. Matt explicitly accepted both the observed influence and the unisolated source-path limit on November 13. FOR-37 comment `ab87b5a1-593e-44e8-bd41-c109eb96265a` records that acceptance. The owner-decision prerequisite is satisfied on this bounded evidence. The internal source path remains unproven. The attestation scope remains `outfitter-dev/forge`. [Adopted hosted reviewer entry](hosted-reviewer-attestations.md#adopted-policy-entry)

The adopted entry selects the reviewer key, bot identity, 900-second wait, explicit independence statement and supplied-global-ledger coverage requirement. The Forge lead owns normal-command qualification under a bounded local trusted policy. FOR-38 owns production identities, trusted installed source/runtime, durable state and root gate-policy configuration. Buildkite and repository-rule adoption require their intended execution surfaces to qualify. The collector/store API's offline resolution checks establish local behavior, while authentication of a deployed resolver remains unqualified. Ranger retains review-ladder and recovery ownership.
