# Proposed collection of configured bots’ findings

Draft for Matt’s confirmation, November 18, 2026. Matt requested a proposal that counts configured bots’ review threads and explicitly handles findings reported elsewhere. This is the proposed amendment for the finding-source decision recorded on November 15 in [FOR-38](https://linear.app/outfitter/issue/FOR-38). Adoption requires Matt’s confirmation and a separately reviewed implementation and policy change.

## Proposed contract amendment

The trusted collector may establish a complete finding inventory for an explicitly configured set of reporting bots on a repository. Completeness means it collected every supported reporting surface for those bots in a complete, stable observation, retained all accepted history, and accounted for each adverse report. The scope and policy revision accompany the completeness claim. A complete inventory may contain unresolved findings and therefore still block landing.

The consumer names each reporting bot by verified stable account ID and provider actor type, with its supported thread, review-body and issue-comment formats. Login names are observations. The consumer qualifies the actual reporters and surfaces before adoption. Adding a bot as a finding source grants no authority to satisfy the independent clean-review requirement. The existing requirement for an acceptable completed review of the exact head and base continues to apply.

For Forge, the proposed sources are Codex, Devin, GitHub code scanning and Cursor, subject to verifying their actual account identities and observed formats. This document supplies no account IDs or source-completeness attestation. Findings already stored under any reviewer continue to participate, including when that reviewer is removed from the active configuration. Every unresolved GitHub review thread continues to block through the existing mergeability check, regardless of its author.

## Collection and adverse reports

Collect all pages of review threads, submitted reviews and issue comments, including reports concerning earlier heads. Read them twice around the revision snapshot using the existing stable-collection boundary. Missing pages, truncation, changed lists, unreadable identities or unsupported report formats leave coverage unknown. Observing an unfamiliar bot reporting a review on a supported surface requires an explicit source-policy decision before coverage can be declared complete.

Stable reads cover what GitHub exposes at observation time. Reports deleted before the first observation and findings delivered only through external dashboards, check results or annotations need separate coverage evidence. Before adopting a bot, qualify where it delivers findings and how retained history accounts for those surfaces. An unexplained gap leaves coverage unknown. Absence from two reads cannot establish an all-time absence of reports.

Each configured bot’s thread becomes a finding identified by that reporter and the native thread ID. Preserve the original attempt and source reference. The collector reads the whole thread’s identity and resolution state, including outdated threads. An empty current thread list cannot erase a previously accepted finding.

Review bodies, summary comments and standalone comments receive a provider-specific deterministic classification with offline fixtures. A supported explicit finding or adverse flag becomes a persistent adverse-review entry. A supported report that references findings is accounted for only when the parser can match its declared finding set to collected native entries. Otherwise it creates an unresolved adverse-review entry even if every visible thread is resolved. Where a provider gives no complete mapping, retain that blocker for the accepted follow-up resolution path.

Recognized clean reports and recognized operational messages, such as a quota notice, may establish that the message itself reports no finding. A quota notice leaves that review attempt unavailable. It supplies no completed clean review. Arbitrary prose, changed templates, ambiguous summaries, conflicting flags and reports edited by an unverified identity leave source coverage unknown. The collector preserves any positively identified adverse evidence alongside that unknown result. A model’s interpretation cannot turn unsupported text into a deterministic clean classification.

A source edit creates a distinct adverse observation when its identity, update time or content digest changes. An edit that removes adverse text, a deleted comment, a dismissed review, a later clean summary or a new commit cannot clear an accepted blocker. Persist native references and digests sufficient to explain the decision while keeping comment bodies and transcripts out of Git.

## Resolution and retained history

For a thread finding, a complete trusted native observation of that same thread’s resolved state may clear its blocker under the configured hosted reviewer’s accepted provenance. The consumer accepts GitHub’s repository permissions for who can resolve the thread. This is an explicit authority choice, and does not prove that the code defect was fixed. Reopening the thread restores its blocker. An accepted thread missing from a later complete list loses any native resolution and blocks again.

An adverse report outside a thread has no native thread-resolution event. It remains unresolved until an eligible independent follow-up review supplies explicit evidence addressing that entry under the existing evaluator’s revision, provenance and follow-up rules. The collector must establish the linkage to the accepted finding. Generic approval, disappearance of text and a manually edited supplied file cannot provide that linkage. A new provider-specific resolution mechanism needs its own policy and qualification before use.

Publish findings and their completeness with the revision snapshot through the existing ledger compare-and-swap. Preserve accepted origins and resolutions according to the [ledger contract](review-ledger-store.md#finding-history-and-compatibility). A failed collection leaves the previous ledger in force. A successful stable collection may add interpretable adverse entries while marking coverage unknown. A concurrent replacement fails the publication. A change in source policy requires fresh coverage qualification and preserves every earlier blocker and its origin. Historical completeness cannot substitute for the current collection’s coverage.

## Qualification before adoption

The implementation must exercise these cases offline through collection, persistence and the gate command.

- A configured bot’s open, resolved, reopened, outdated and missing threads, plus a finding retained after head/base changes or reporter removal.
- A finding reported only in each non-thread surface, an adverse summary with no matching thread, and clean output contradicted by an adverse report.
- Stable identity despite a renamed login, null or migrated identities, an unverified editor, and an unfamiliar reporting bot.
- Pagination bounds, missing or duplicate pages, changing observations, unsupported formats, edited or deleted reports, and a failed ledger compare-and-swap.
- Recognized quota/unavailable messages, a valid independent clean review from another eligible provider, and an explicit qualified follow-up addressing a retained adverse entry.
- No supplied review-evidence file on the Buildkite lane, no copied clean attempt that overrides collection, and no passing gate from an unknown inventory.

Live qualification must record the repository, exact head/base, trusted source and policy revisions, reporting identities, supported formats and all collection references. Demonstrate the three non-thread reporting surfaces and thread resolve/reopen behavior on a controlled PR, including fresh evaluation without a new commit. If a provider’s real format or access cannot be established, keep its coverage unknown and record the accountable owner and next action.

The adoption PR must state the precise supported source set and resolution authority Matt confirms. The existing `supplied-global-ledger` policy continues to govern until that adoption is qualified and delivered. Provider access changes and review execution remain with their existing owners.
