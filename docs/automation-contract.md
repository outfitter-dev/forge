# Forge Automation Contract

This document defines the behavior and trust boundaries Forge operations must preserve as they are adopted. It governs evidence, authority, provider semantics, and migration. The [design tenets](tenets.md) govern how we construct the software that upholds this contract. Neither document claims that the bootstrap already implements these guarantees.

If an implementation conflicts with this contract, correct the implementation or revise the contract with the project owner’s approval, recording the reason and consequences. An implementation change cannot waive a guarantee on its own. A passing test or a tactical workaround does not waive a requirement.

## Ownership stays with the system that knows

Forge owns engineering automation, gate evidence and receipts, deterministic gates, landing eligibility, and release qualification. Ranger owns the agent harness, agent workflows, tools, prompts, sessions, agent execution, run history, and structured assessments. Product repositories own their build, test, and lint commands and task graphs. Execution hosts enforce permissions and isolation; hosted services enforce their own queues, access controls, and repository rules.

Compose those responsibilities through explicit contracts. A shared workflow invokes a product's declared task; it does not become a second build system. An agent review consumes Ranger's supported contract when one exists; Forge does not duplicate the agent loop or the meaning of an agent workflow. Ranger runs the review ladder: reviewers, models, guidance, clean-context launches, and deadlines. Forge decides which evidence is acceptable, binds it to a revision, and evaluates the gate. Existing schedulers and build tools should carry the responsibilities they already supply. Ranger reports what ran and how it met its task; Forge decides what that evidence establishes for its gates. Changes to this shared boundary should be reconciled in both repositories; neither repository silently grants itself the other’s responsibilities.

## Evidence earns the decision

A green status is meaningful only when the evidence establishes the required outcome. Keep verification, agent review, assigned-human review, and landing eligibility distinguishable. A successful API request proves that the request succeeded; it does not prove that an agent finished, findings were resolved, an artifact qualified, or a change landed.

No single review provider is required. Agent review needs one acceptable, completed, explicitly complete, clean review of the exact head and base, from any reviewer the consumer has made eligible. A reviewer that is unavailable is recorded as unavailable: that is never a clean review, and it does not block on its own. An unresolved finding from any reviewer that reported blocks, including one that arrives after that reviewer's deadline, and another reviewer's clean result does not resolve it. When every review option is exhausted the change is blocked for a human; it never lands unreviewed, and an ordinary human-review approval is not agent-review evidence. The project owner decided this on November 11, 2026 (FOR-26), because a required provider that is rate-limited or down would otherwise block a change indefinitely. The consequence is that review coverage depends on the consumer's eligible reviewers and on a complete record of reported findings.

Missing, stale, canceled, failed, ambiguous, or incomplete required evidence cannot authorize progression. An evaluation that could not complete cannot authorize progression either. Report what is known and what remains unsatisfied. Model judgment can contribute an assessment under explicit policy; it cannot override a deterministic blocker.

## Evidence belongs to an exact subject

Evidence identifies the repository, source revisions, producer, and execution context needed to establish what it proves. Bind review and verification receipts to the relevant head and base. Merge-candidate checks prove integration behavior; they do not replace each member's required admission evidence.

Retain the provenance needed to invalidate evidence when its assumptions change, including relevant model, harness, prompt, and policy configuration. A collector must validate the producer and source binding before normalizing evidence. Adding the current revision to an unbound provider response does not make it current. Shape validation and revision matching do not authenticate the producer.

## Reuse does not confer authority

Sharing an implementation does not share credentials, trust, or permission to act. Repository identity, authorized actors, eligible reviewers, execution queues, and release destinations remain explicit. A personal repository does not inherit organization credentials because it runs the same code.

An eligibility decision is an input to an authorized landing operation, not a grant of merge permission. Building an artifact does not authorize publication. Keep the authority for each consequential action separate from the reusable mechanism that performs it.

## Proposed code cannot govern its own acceptance

Run trusted orchestration and policy from a trusted revision outside the proposed checkout. Proposed code may supply the product implementation and tasks under evaluation; it cannot replace the evaluator, waive required evidence, or access privileged orchestration credentials.

Treat checked-out code, model output, and provider responses according to their trust boundary. Validate external data when it crosses a typed boundary, and preserve the distinction between a well-formed claim and verified evidence. Trusted collection and authorized execution remain necessary even when the pure evaluator is correct.

## Preserve meaning across providers

Share behavior only when the underlying semantics match. Adapters may translate names and representations, but they must preserve consequential differences in review states, cancellation, identity, permissions, and service capabilities.

When a provider cannot establish a required fact, expose the limitation and keep that requirement unsatisfied. A green check without findings data is not equivalent to a completed clean review. Prefer an explicit provider-specific contract over a portable-looking abstraction that hides missing guarantees.

## Qualification precedes replacement

A migration succeeds when the consuming workflow is proven, including its failure behavior. Carry forward concrete regressions and trust boundaries, then qualify the replacement in the intended environment before retiring the previous path.

Use small, reversible adoption steps. Test shared code locally before adding a CI adapter, and verify distribution and access with the intended consumer before promising reuse. Package publication, worker deployment, cross-owner access changes, and product migration each need their own explicit scope and authority.

## Decisions leave usable evidence

A result should let the next person or agent understand what ran, against which subject, under which policy, and why it passed or stopped. Preserve actionable reasons, provenance, and the distinction between blocked work and completed work. Recheck mutable service state before consequential actions; a prior receipt is not proof that the target has remained unchanged.

Put durable facts in their owning artifact and link to them from other surfaces. Forge receipts can reference Ranger-owned run history without duplicating transcripts or requiring a shared store. Keep credentials, private runtime state, logs, caches, and transcripts out of Git. Auditability requires sufficient evidence, with access and retention appropriate to that evidence; it does not justify copying sensitive material into source control.

## Consumer qualification

These are acceptance criteria for operations as they are adopted:

- The same normalized facts and policy produce the same deterministic decision, regardless of the invoking adapter.
- Results explain unmet requirements without turning unknown states into success.
- Authority and provenance remain explicit through collection, evaluation, reporting, and action.
- Local verification of deterministic behavior is offline and credential-free by default. Live integration qualification is identified separately.
- Changes to observable behavior carry tests, including the failure cases that could otherwise permit an unsafe pass.
- Adoption includes the contract, usage instructions, and qualification evidence needed by the next consumer. Unsupported behavior remains visible.

See the [implementation handoff](handoff.md) for current adoption status and unresolved integration decisions.
