# Hosted reviewer attestations

Under evidence schema version 2, a credible review requires `context: "none"`. A collector cannot observe the independence of a reviewer running on a vendor's service. Trusted policy may attest that fact for a named hosted reviewer under the exception in the [evidence evaluator contract](evidence-evaluator.md#trusted-collector-responsibilities).

An attestation records the policy owner's decision and its limits. Collection must still establish the review's identity, completion, exact subject and findings. The evaluator checks normalized claims against policy and cannot authenticate the attestation.

## Rules

- An attestation names one reviewer, its output identity, the repository whose policy adopts it, and the policy owner's decision. It covers only that reviewer reached through that interface.
- Adoption requires a distinct explicit statement in trusted collector policy, pinned outside the proposed checkout. Listing a reviewer in `EvidencePolicyV2.agentReview.reviewers` does not attest independence. That schema has no attestation field and rejects additional fields. A collector policy extension must define the statement before adoption.
- A hosted reviewer without an applicable attestation stays `context: "unknown"`. A local review continues to require established clean context under its own collection contract.
- The collector retains the attestation identifier, trusted policy revision and reviewer identity alongside its source observations and normalized result. That record lets a reader distinguish an attested `none` from observed clean context. The version 2 attempt and evaluator result alone cannot make that distinction.
- An attestation covers independence only. Missing, stale, incomplete or adverse evidence keeps its existing meaning. Findings and detail-less adverse verdicts persist in the ledger until an accepted resolution.
- Each entry records its basis, known weaknesses and conditions for withdrawal. The policy owner establishes which evidence an attestation may accept. Routine delivery within that agreed policy follows [standing delivery authority](../AGENTS.md#standing-delivery-authority). Withdrawal restores `unknown` and preserves accepted findings.

The fictitious hosted reviewers in `examples/evidence/v2/` and test fixtures are supplied normalized claims for exercising the evaluator. They do not establish a real collector's attestation or qualify a hosted service.

## Codex hosted code review

Status on November 13, 2026 is independence basis accepted by Matt, with production lane adoption pending. Matt accepted both the observed proposed-guidance influence and the source-path uncertainty recorded in PR #49. That decision satisfies the owner-decision condition below. His November 12 confirmation of the revised PR #38 contract includes the last-editor rule and inactive all-null security section. The [guidance qualification record](codex-guidance-qualification.md) preserves the experiment and its limits. This entry is scoped to `outfitter-dev/forge`. [FOR-37 decision record](https://linear.app/outfitter/issue/FOR-37)

### Adopted policy entry

| Field | Selected value |
| --- | --- |
| Repository | `outfitter-dev/forge` |
| Reviewer key | `codex-github` |
| Bot account ID | `199175422`, with author and editor both type `Bot` |
| Attestation ID | `forge/codex-github/2026-11-13` |
| Decision revision | `linear-comment:ab87b5a1-593e-44e8-bd41-c109eb96265a` |
| Independence statement | `separate-hosted-invocation-without-inherited-author-context` |
| Hosted wait | `900` seconds from the persisted snapshot |
| Finding-history policy | `supplied-global-ledger` |

The Forge lead selected a finite 15-minute hosted wait to allow review startup and execution while retaining a deadline. The roughly one-minute disposable observation establishes one observed duration. The selected wait is a policy bound, with timeout semantics defined by the collector. Later adverse findings remain blocking after that bound.

The corresponding `codexReview` extension is explicit trusted configuration.

```json
{
  "reviewer": "codex-github",
  "botAccountId": 199175422,
  "findingHistory": "supplied-global-ledger",
  "independence": {
    "id": "forge/codex-github/2026-11-13",
    "policyRevision": "linear-comment:ab87b5a1-593e-44e8-bd41-c109eb96265a",
    "statement": "separate-hosted-invocation-without-inherited-author-context"
  }
}
```

The matching eligible hosted reviewer entry must use the selected key and wait. The invoker authenticates a current complete supplied finding ledger covering all reporting reviewers, including sources such as Devin, and preserves accepted history. Unknown coverage stays non-passing. FOR-38 owns the production collector, verification and reviewer issuer identities and runtime fingerprints, trusted installed source, state location and root `forge-gate.json`. The bounded local qualification uses its own explicitly identified runtime and producer. The production policy must load this entry from its trusted revision outside the proposed checkout.

[FOR-37](https://linear.app/outfitter/issue/FOR-37) retains the decisions, vendor-documentation check, raw observation pointers and collector design. That check found no supported machine-readable contract for the markers below. Their format is observed. The observed clean review and adverse review came from Forge PRs 26 and 27.

### Identity and state

A collection must read exactly one summary comment whose body starts with `<!-- codex-pull-request-review-summary -->` and contains exactly one `codex-review-state:v1` block. Zero summaries, duplicate summaries, ambiguous blocks and unsupported versions cannot establish a clean review. Codex edits one summary in place when it reviews again, so the single current summary governs the collection.

Both the summary's author and its last editor must be the configured Codex bot account, checked by account ID and bot type. Unknown editor identity cannot satisfy that rule. GraphQL supplies the editor identity that the REST comments response omits. The account ID is trusted configuration rather than a constant in the parser. The observed account was `chatgpt-codex-connector[bot]`, ID `199175422`.

The version 1 state has exactly two section keys, `code_review` and `security_review`. Each section has exactly `commit_sha`, `has_any_findings`, `has_unresolved_findings` and `status`. For a passing code review, `code_review` has a full lowercase 40-character commit, two booleans and `status: "completed"`, with no null field. The raw samples have all four `security_review` fields null. Matt accepted treating that section as inactive in the PR #38 confirmation. It establishes no security review, and any reported findings from either section must be retained as adverse evidence. Other section states need an explicit tested interpretation before they can support a pass.

The collector attributes review threads by the first comment's bot account ID and type, using the same identity rule. It reads all threads, including those from earlier heads, with complete pagination. The summary, its author and editor, its update time, and the full attributed thread list join collection's two-pass stability check.

### Exact subject

The reviewed commit must equal the head of the same stable collection. A report naming another head is never relabelled with the current one. Codex's state names no base, so the base is bound only through the collector's own earlier persisted snapshot of that head and base. The summary must have been updated strictly after that snapshot and no later than the collection's served time, with no intervening base change. A review completed before the first snapshot cannot qualify until Codex reviews again under a later update.

### Outcomes and findings

| Observation | Meaning |
| --- | --- |
| Identity, editor, shape, version, uniqueness or binding cannot be established | Unavailable evidence cannot satisfy a review. Existing ledger findings persist. |
| Valid current-subject state has not completed | Pending until the configured wait ends, then unavailable. Existing ledger findings persist. |
| Completed current-subject review reports findings or unresolved findings | Completed adverse review with a failed verdict. Record its threads, or a detail-less `adverse-review` entry if no thread is visible. |
| Completed current-subject code review reports neither flag, and collection finds no unresolved Codex thread | A candidate clean review, subject to the attestation, policy and complete finding ledger. |

A reported adverse verdict or finding is retained even when other evidence cannot establish a credible completed attempt. Malformed or stale clean-looking evidence cannot erase it. A clean review from another reviewer resolves nothing in that ledger.

Thread IDs are the stable native finding identities. An observed resolved thread supplies provider-native resolution, a reopened thread restores the blocker, and a disappeared thread stays recorded and blocking. A detail-less adverse-review entry has no thread resolution. The configured deadline never removes a reported finding.

The collector may record `context: "none"` only because Forge's trusted collector policy explicitly adopts this attestation. The reviewed head/base, completion and findings remain collection requirements. The vendor-documentation check recorded on FOR-37 describes GitHub reviews reporting P0 and P1 findings, so a clean report carries that coverage limit.

### Basis and weaknesses

The basis for the proposed independence attestation is a separate hosted review invocation, without inherited author-session context. The collector cannot observe the vendor's internal session, memory or filesystem isolation. The policy owner accepts that assumption and the following weaknesses.

- The author's pull request description, commit messages and proposed files reach the reviewer and can carry instructions.
- Codex's disposable experiment output used the proposed head's guidance marker and explicitly cited that head's `AGENTS.md`. Both markers were visible in the diff and Devin had already posted the head marker, so the internal revision-loading path remains unproven. The lead treats this observed influence as reaching the policy-owner decision condition before adoption. See the [qualification record](codex-guidance-qualification.md#observed-review).
- A commenter can request a review with additional focus instructions.
- A Codex-authored change and a Codex review can use the same vendor's models. A separate invocation alone does not establish independent judgment.
- The bot creator identity alone cannot establish who wrote a summary's current body. The last-editor rule addresses edited summaries. Persisted findings preserve blockers when inline comments disappear.
- Account identity and markers do not establish the model or instructions that produced a review. OpenAI could change a field's meaning without changing its shape, and strict shape validation could not detect that change.

### Before adoption

1. Use the confirmed scope of this entry and its independence exception, including the last-editor rule and the inactive all-null security section observed in the samples. Further scoped PRs proceed under standing delivery authority.
2. Implement and test the distinct collector-policy attestation, strict parser, stable collection, exact base binding and persisted findings.
3. Record one live observation on Forge separately from offline fixtures, and identify the format as observed in policy and usage documentation.
4. Establish which `AGENTS.md` revision Codex follows with one bounded test on an agreed disposable repository. If the proposed copy governs the review, obtain the policy owner's decision before enabling the entry. The [November 13 experiment](codex-guidance-qualification.md) records head-guidance influence but leaves the internal source path unproven because the diff and earlier review expose the marker too. Matt explicitly accepted both that evidence limit and observed influence as the adoption basis on November 13, recorded in the decision revision above. This owner-decision prerequisite is satisfied under that accepted basis.

Withdraw the attestation if its basis fails, the vendor establishes an incompatible interface, a supposedly clean state contradicts reported findings, or the policy owner rejects observed guidance influence. The hosted reviewer then stays `unknown`, and its persisted findings remain.
