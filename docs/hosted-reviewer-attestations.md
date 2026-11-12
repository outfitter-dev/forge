# Hosted reviewer attestations

The `agent-review` gate passes only on a review whose `context` is `none`: the reviewer inherited nothing from the author. Forge cannot observe that for a reviewer that runs on a vendor's service. The [evidence evaluator's contract](evidence-evaluator.md#trusted-collector-responsibilities) therefore leaves such a reviewer's context `unknown`, which lets it block and never lets it pass, unless trusted policy attests its independence.

This document is the record of those attestations. An attestation is a decision by the person who owns the policy, written down with what supports it and what weakens it. It is not evidence, and nothing in Forge checks it. A collector may record `context: "none"` for a hosted reviewer only when the trusted policy it runs under carries the attestation, and only for the reviewer that entry names.

## Rules

- An attestation names one reviewer and one way of identifying its output. It does not extend to another reviewer from the same vendor, or to the same reviewer reached another way.
- It comes from trusted policy, never from the pull request under evaluation, a comment, or the reviewer's own output.
- It covers independence only. Whether a review exists, is complete, is for the current head and base, and reported no findings is still established by collection, under that reviewer's own rules.
- Each entry states its basis, its known weaknesses and what would end it. An entry whose basis no longer holds is removed, and the reviewer goes back to `unknown`.
- Adding, changing or removing an entry changes what the gate accepts. It is the policy owner's decision and is made in a pull request the owner confirms.

## Codex hosted review

Status on November 12, 2026: decided, not in effect. No collector for Codex exists in this repository and no policy names Codex as a reviewer. The decisions and the collector's design are tracked in [FOR-37](https://linear.app/outfitter/issue/FOR-37).

Matt made two decisions on November 12, 2026.

**The observed format may satisfy the gate.** OpenAI documents that Codex "posts a standard GitHub code review" from its GitHub app. It does not document the machine-readable state Codex puts in its summary comment. That format is observed, not supported. A Codex review counts as clean only when all of these hold, and anything else is an unavailable review, never a clean one:

- The summary comment's author is the Codex app's bot account, checked by account ID and type.
- The state is version 1 with exactly the known fields, and none of the code review's fields is `null`.
- It says completed, names the pull request's current head, and reports no findings and none unresolved.
- The collector itself sees no unresolved review thread whose first comment is from that bot.

**Policy may attest that a Codex review is independent.** The collector records `context: "none"` for Codex because the trusted policy entry says so.

Basis:

- OpenAI's service starts the review from a pull request event or a comment and runs it on OpenAI's side. It has no channel to the session that wrote the change.

Known weaknesses:

- Codex follows the repository's `AGENTS.md`. Whether it reads the base branch's copy or the pull request's own has not been established. If it reads the pull request's, a change can instruct its own reviewer.
- Anyone who can comment on the pull request can start a review with instructions of their own, such as `@codex review` followed by a focus.
- A change written by a Codex task is reviewed by the same vendor's model in a separate run. Separate runs are not separate judgment.

Residual risk:

- OpenAI could change what a field of the state means without changing its shape, for example what counts as a finding or when the status becomes completed. Strict validation fails closed on a changed shape and cannot detect a changed meaning.
- The bot's account ID shows that GitHub attributes a comment to that account. It is observed, not documented by the vendor, and it does not show which model or instructions produced the review.

Before a policy entry for Codex lands:

- One live observation on a Forge pull request is recorded, separately from the offline fixtures.
- The entry and the collector's documentation call the format observed, not supported.

What would end the attestation: OpenAI documenting a different interface; an observed review whose state said clean while Codex had reported findings; or evidence that Codex takes its instructions from the pull request under review in a way the owner does not accept.
