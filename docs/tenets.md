# Forge Design Tenets

> Build small, composable operations whose behavior can be understood and verified.

These tenets govern how we design and build Forge. They guide module boundaries, interfaces, dependencies, diagnostics, tests, and evolution. The [automation contract](automation-contract.md) separately defines what Forge must uphold when handling evidence, authority, and adoption. Construction principles and behavioral guarantees support each other. Where a simpler construction would weaken a contract guarantee, the guarantee holds; the tenets govern how the required mechanism is built.

Tenets should outlast tool versions and individual features. Current commands belong in the README and repository guidance, implementation state belongs in the handoff, and consequential design choices belong in decision records when those choices arise. When implementation conflicts with a tenet, correct the implementation or explicitly revise the tenet with the project owner, recording the reason and consequences.

## Principles

### Give each module one coherent responsibility

Organize code around operations and boundaries that can be understood and changed independently. Collection, evaluation, reporting, and authorized action have different dependencies and reasons to change. Keep their interfaces small and their dependencies explicit.

Compose those responsibilities instead of accumulating them in a central CLI or workflow file. A module is useful when it owns a coherent behavior, not merely because it shortens another file. A module boundary does not need a package; package boundaries must earn their distribution or dependency cost.

### Implement shared meaning once

An operation is a unit of behavior a consumer invokes for an outcome, such as evaluating evidence or publishing a status. An ordinary typed function with explicit inputs, dependencies, and results can be a complete operation.

Local commands and CI adapters should invoke the same operation. Adapters own transport, execution context, and presentation; the operation owns its meaning. A fix to a shared decision should not require matching edits in several workflow implementations.

Derive repeated information from the definition that owns it when the derivation is mechanical; a shared constant or function is usually enough. Defaults and derivation must not invent authority or evidence. Identity inferred from an execution environment must be validated by the boundary that owns it. Share only what is semantically shared: provider-specific behavior should remain explicit when normalizing it would erase a consequential difference. Avoid both duplicate logic and abstractions that make unlike operations look interchangeable.

### Make contracts explicit at boundaries

Use strict types to describe inputs, results, dependencies, and failure states. Validate external data when it crosses into the typed contract; types alone cannot establish the shape of JSON from another process, and shape validation does not establish who produced it. After validation, internal code should rely on the established contract rather than repeatedly reconstructing it.

Represent distinctions that affect decisions in the data model. Missing evidence, a failed check, a canceled run, and invalid input need distinguishable results. Keep repository identity and execution authority explicit in interfaces that need them. Add a schema dependency only when the adopted boundary benefits from it.

### Keep decisions separate from effects

Build deterministic evaluation as facts and policy in, decisions out. Supply external observations explicitly. Keep filesystem access, service calls, credentials, status publication, and process exits at the boundaries that own them.

Side-effecting operations remain necessary. Make their effects and dependencies visible so callers can understand what an invocation may change and tests can exercise failure behavior. This separation supports local verification and adapter reuse without requiring a dependency-injection framework.

### Design for observability

An operation's result should make its behavior explainable: what it attempted, which inputs and policy mattered, what completed, and why it stopped. Preserve structured reasons and provenance at the point they are known, rather than asking a reporting adapter to infer them from prose logs.

Keep diagnostics useful to both humans and automation. Carry the identifiers needed to connect results to their evidence and distinguish stages of a workflow. Observability belongs in operation contracts from the start; it does not require deploying a telemetry platform before the first operation exists. The automation contract defines the evidence and privacy boundaries those diagnostics must respect.

### Make correctness easy to exercise

Design operations so their meaningful success and failure paths can be tested without credentials or live services. Use representative fixtures at external boundaries and test observable results rather than private implementation shape. Preserve concrete regressions as tests where they can prevent recurrence.

Separate deterministic tests from live integration qualification. An offline fixture can prove how Forge handles a provider response; it cannot prove that the provider emits that response or that a consumer has access. Verify each claim at the boundary that can establish it. Use failures to improve contracts and checks before adding procedural reminders.

### Use existing strengths before adding machinery

Use what the adopted runtime, language, CI services, build tools, and Ranger already provide before adding a library or layer. Keep product task graphs with product repositories and agent workflows with Ranger. Forge should not maintain parallel implementations of capabilities those systems already own.

Start with a useful operation for a concrete consumer. Prefer configuration or an existing primitive when it solves the problem clearly. Introduce abstractions, dependencies, and additional packages when adopted behavior demonstrates their value. A possible future provider is not sufficient reason to build a provider framework.

### Evolve through complete, reversible slices

Build the smallest end-to-end capability that can demonstrate its contract, including failures, diagnostics, tests, and usage guidance. Qualify a local operation before broadening its execution surfaces. Separate changes that establish behavior from changes that deploy it or migrate consumers.

Results, receipts, and policy inputs can outlive the revision that produced them. When their meaning changes, make the change explicit to readers rather than silently reinterpreting old records under new rules. Add compatibility handling for existing consumers and data, not hypothetical ones. Record why a consequential choice was made in the owning repository, and link to that record instead of duplicating it across handoffs. Refine the design from observed use; preserve a working path while a replacement is being qualified.

## Applying the tenets

For a proposed change, identify the useful outcome, the module that owns it, its contract and dependencies, how its behavior will be observed, and the check that proves it works. Choose the smallest implementation that preserves those properties and the automation contract. Scale this reasoning to the change; these are design questions, not a required document template.

For example, a Buildkite adapter should translate invocation and reporting around an existing evaluator. A new review provider may need its own boundary validator and fixtures when its evidence has different semantics. Neither case automatically calls for a new package or provider framework.

These principles draw on Trails' shared contracts and reduced ceremony, Skillset's faithful adaptation and explicit boundaries, and historical Ranger's live verification and durable decisions. Coordinate shared conventions with the current Ranger while respecting each project's ownership. Shared principles do not establish an API, storage design, or enforcement guarantee.
