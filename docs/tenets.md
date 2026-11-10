# Forge Design Tenets

> Shared operations, explicit authority, verifiable outcomes.

These tenets govern Forge's engineering automation: reusable operations, execution adapters, evidence collection, deterministic gates, and release qualification. They describe durable design commitments. Tool versions and commands belong in the README and repository guidance; current implementation and migration state belong in the handoff; consequential design choices belong in decision records when those choices arise.

When implementation conflicts with a tenet, bring the implementation into alignment or explicitly revise the tenet with the reason and consequences recorded. A tactical workaround does not silently change the contract. These commitments guide new work; they do not claim that the bootstrap already implements every guarantee.

## Principles

### One operation, many execution surfaces

A reusable operation has one contract and one implementation. Local commands, GitHub Actions, and Buildkite integrations adapt inputs, execution context, and reporting around that operation. They do not maintain competing definitions of success.

Keep deterministic evaluation separate from collection and side effects. An evaluator should accept facts and policy and return decisions without reading credentials, querying a service, publishing status, or exiting the process. Operations that perform side effects make those effects explicit in their contract. This separation makes the same behavior testable locally and usable from adopted CI surfaces.

### Ownership stays with the system that knows

Forge owns engineering automation, evidence, deterministic gates, and release qualification. Ranger owns the agent harness, agent workflows, tools, prompts, sessions, execution, and structured assessments. Product repositories own their build, test, and lint commands and task graphs. Execution hosts enforce permissions and isolation; hosted services enforce their own queues, access controls, and repository rules.

Compose those responsibilities through explicit contracts. A shared workflow invokes a product's declared task; it does not become a second build system. An agent review consumes Ranger's supported contract when one exists; Forge does not duplicate the agent loop or the meaning of an agent workflow. Existing schedulers and build tools should carry the responsibilities they already supply.

### Evidence earns the decision

A green status is meaningful only when the evidence establishes the required outcome. Keep verification, agent review, assigned-human review, and landing eligibility distinguishable. A successful API request proves that the request succeeded; it does not prove that an agent finished, findings were resolved, an artifact qualified, or a change landed.

Missing, stale, canceled, failed, ambiguous, or incomplete required evidence cannot authorize progression. Report what is known and what remains unsatisfied. Model judgment can contribute an assessment under explicit policy; it cannot override a deterministic blocker.

### Evidence belongs to an exact subject

Evidence identifies the repository, source revisions, producer, and execution context needed to establish what it proves. Bind review and verification receipts to the relevant head and base. Merge-candidate checks prove integration behavior; they do not replace each member's required admission evidence.

Retain the provenance needed to invalidate evidence when its assumptions change, including relevant model, harness, prompt, and policy configuration. A collector must validate the producer and source binding before normalizing evidence. Adding the current revision to an unbound provider response does not make it current. Shape validation and revision matching do not authenticate the producer.

### Reuse does not confer authority

Sharing an implementation does not share credentials, trust, or permission to act. Repository identity, authorized actors, required providers, execution queues, and release destinations remain explicit. A personal repository does not inherit organization credentials because it runs the same code.

An eligibility decision is an input to an authorized landing operation, not a grant of merge permission. Building an artifact does not authorize publication. Keep the authority for each consequential action separate from the reusable mechanism that performs it.

### Proposed code cannot govern its own acceptance

Run trusted orchestration and policy from a trusted revision outside the proposed checkout. Proposed code may supply the product implementation and tasks under evaluation; it cannot replace the evaluator, waive required evidence, or access privileged orchestration credentials.

Treat checked-out code, model output, and provider responses according to their trust boundary. Validate external data when it enters the contract, and preserve the distinction between a well-formed claim and verified evidence. Trusted collection and authorized execution remain necessary even when the pure evaluator is correct.

### Preserve meaning across providers

Share behavior only when the underlying semantics match. Adapters may translate names and representations, but they must preserve consequential differences in review states, cancellation, identity, permissions, and service capabilities.

When a provider cannot establish a required fact, expose the limitation and keep that requirement unsatisfied. A green check without findings data is not equivalent to a completed clean review. Prefer an explicit provider-specific contract over a portable-looking abstraction that hides missing guarantees.

### The smallest useful operation earns its place

Start with a concrete consumer and an independently useful operation. Prefer existing tools, configuration, and composition before adding infrastructure. Add abstractions when adopted behavior requires them, with a clear responsibility and a demonstrated benefit.

Reduce repeated authoring when the system already has the necessary facts. Defaults may remove mechanical ceremony; they must not invent authority or evidence. One package is sufficient until real boundaries justify another. Experimentation can establish that need without becoming an implied production commitment.

### Qualification precedes replacement

A migration succeeds when the consuming workflow is proven, including its failure behavior. Carry forward concrete regressions and trust boundaries, then qualify the replacement in the intended environment before retiring the previous path.

Use small, reversible adoption steps. Test shared code locally before adding a CI adapter, and verify distribution and access with the intended consumer before promising reuse. Package publication, worker deployment, cross-owner access changes, and product migration each need their own explicit scope and authority.

### Decisions leave usable evidence

A result should let the next person or agent understand what ran, against which subject, under which policy, and why it passed or stopped. Preserve actionable reasons, provenance, and the distinction between blocked work and completed work. Recheck mutable service state before consequential actions; a prior receipt is not proof that the target has remained unchanged.

Put durable facts in their owning artifact and link to them from other surfaces. Forge receipts can reference Ranger-owned run history without duplicating transcripts or requiring a shared store. Keep credentials, private runtime state, logs, caches, and transcripts out of Git. Auditability requires sufficient evidence, with access and retention appropriate to that evidence; it does not justify copying sensitive material into source control.

## Promises to consumers

These are acceptance criteria for operations as they are adopted:

- The same normalized facts and policy produce the same deterministic decision, regardless of the invoking adapter.
- Results explain unmet requirements without turning unknown states into success.
- Authority and provenance remain explicit through collection, evaluation, reporting, and action.
- Local verification of deterministic behavior is offline and credential-free by default. Live integration qualification is identified separately.
- Changes to observable behavior carry tests, including the failure cases that could otherwise permit an unsafe pass.
- Adoption includes the contract, usage instructions, and qualification evidence needed by the next consumer. Unsupported behavior remains visible.

## Applying the tenets

For a proposed operation, identify its consumer, owning system, input and output contract, authority, evidence, and verification. Choose the smallest implementation that satisfies those facts. Turn recurring failures into boundary validation, fixtures, tests, or service enforcement rather than relying on a longer checklist.

For example, adding a Buildkite adapter to an existing evaluator should reuse its decisions and translate reporting. Adding a new review provider requires evidence that its normalized result preserves source identity and findings semantics. Neither change authorizes altering a product's task graph or granting new credentials.

## Relationship to neighboring projects

Trails contributes the discipline of one contract across surfaces and reducing drift through derivation and checks. Skillset contributes faithful adaptation, inspectable provenance, and the separation of artifact production from runtime authority. Historical Ranger contributes live verification, durable decisions, reversible progress, and respect for project-local doctrine. Those are influences, not dependencies on their implementation or historical operating model.

Forge and the current Ranger should share conventions for explicit contracts, evidence, authority, and visible failure. Each repository owns its tenets. Changes to their shared boundary should be reconciled in both repositories; neither repository silently grants itself the other's responsibilities. Shared principles do not establish an API, storage design, or enforcement guarantee; those require their own accepted contracts.

See the [implementation handoff](handoff.md) for current scope and unresolved adoption decisions, and [legacy Forge retirement](legacy-forge.md) for the historical project boundary.
