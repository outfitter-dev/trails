# Trails Design Tenets

> Capabilities as contracts: define once, trailhead everywhere.

This is the stable doctrinal layer for the Trails framework. It governs. Where the repo may at times drift from this document, it's the repo that should be brought into alignment, not our tenets.

## Contributor docs

This document sits at the top of a purposeful, multi-tier documentation structure, organized by rate of change:

- **Tenets** (you are here): What we believe and why. Changes when our model of the world changes, which should be rare.
- **Decisions** (ADRs): Where we've been, what's true today, and what might change down the path. These are our human-readable contracts that govern the state of the project. Once accepted, the contracts remain stable until there is a sufficient justification to blaze a new trail.
- **Fieldguides**: How we build, with technical patterns, code examples, and dependency choices. Changes when we ship features or refine APIs. These are more stable, but still change.
- **Trail Notes** (`AGENTS.md`): Repo conventions, commands, and workflow. Changes when the repo changes. Frequent.

## Principles

These are the foundational beliefs of the framework. Every feature, ADR, and API decision must be consistent with them. If a proposal conflicts with a principle, the proposal changes, not the principle.

### The trail is the product

A trail definition is the source of truth. Trailheads (CLI, MCP, HTTP, WebSocket) are renderings of the trail contract, not separate implementations. One trail, many trailheads, zero divergence.

The trail is the unit of everything. Testing targets the trail. Governance targets the trail. Composition follows the trail. As the framework matures, versioning, permissions, and triggers will target the trail too. The trail is where capability lives.

### One schema, one Result, one error taxonomy

Every trail has one input schema and one output schema. Every implementation returns one Result type. Every error belongs to a taxonomy that maps deterministically to every trailhead's error representation.

Drift across trailheads is structurally harder than alignment. You cannot have different parameter names across trailheads because there is only one schema.

### Schema always exists

There is no untyped state. If a trail accepts input, the input has a schema. If a trail returns output, the output has a schema. If a developer emits an event, the payload has a type. If a service has config, the config has a shape.

The question is never "does a schema exist?" but "where is the schema authored?" The framework captures the schema at the earliest possible point and makes it available to every consumer.

### One write, many reads

Every authored artifact should feed multiple consumers simultaneously. The developer writes something once. The framework reads it many ways.

A trail ID feeds the CLI command name, MCP tool name, HTTP route path, log prefix, and lockfile key. An input schema feeds flag derivation, tool parameters, request handling, validation, documentation, and mock generation. Intent feeds the HTTP verb, CLI safety presets, MCP annotations, governance rules, and dry-run behavior. An error class feeds the exit code, HTTP status code, JSON-RPC error code, and error documentation. An examples array feeds testing, agent guidance, schema validation, mock data, composition testing, and contract coverage.

When evaluating a proposed feature, ask: does this multiply the value of something the developer already authored, or does it require them to author something new? Prefer multiplication. If authoring one thing doesn't automatically feed every consumer that needs it, the framework has a bug.

### The contract is queryable

The trail system is machine-readable at runtime. Agents, tooling, and CI can inspect the full topology, including schemas, examples, relationships, intent, and metadata, directly from the contract.

An agent connecting to an unfamiliar app can discover what's available, what inputs are expected, what outputs to anticipate, and what errors to handle, all from the contract, before making a single call. The contract is the source of truth for the system, not documentation about it.

### Reduce ceremony, not clarity

Trails should reduce ceremony wherever the framework can truthfully carry the burden. If a core pattern requires users or agents to restate the same intent repeatedly, that repetition is design feedback, not an inherent cost of the domain.

Repeated ceremony is a framework smell. When the same setup keeps appearing around a core capability, the framework should consider absorbing that burden into derivation, defaults, layers, first-party capabilities, or a stronger primitive.

The goal is not smaller trailhead area for its own sake. The goal is a smaller user burden. The real cost of ceremony is not just typing. It is drift, boilerplate, and future refactor load. Simplicity at the trailhead must still rest on inspectable ground truth underneath.

### Add with intent, not trend

New built-in capability should be added only when it reinforces the broader Trails story. Additions must strengthen the existing principles, primitives, and patterns rather than fragment them.

Good additions reduce ceremony, lower drift potential, impose an acceptable footprint cost, create a stronger operating contract, and compound value across trailheads, testing, governance, and agent ergonomics. Additions without deep consideration are just future tech debt.

This does not preclude experimentation. Trails itself was formed through iteration, refinement, and repeated shaping over time. The key is that experimentation should feed the core story, not bypass it. Broadening the built-in trailhead is worth doing when it is a net win across the system. It is not worth doing to chase a trend or accumulate trailhead area.

### The information architecture

Six categories describe how information flows through the system. Understanding these categories is essential for evaluating any proposed feature or API change.

**Authored.** New information only the developer knows. Schemas, intent, metadata, examples, the run function, trail IDs. Creative contributions that cannot be derived because they don't exist until someone writes them.

**Projected.** Mechanically derived from authored information, guaranteed correct. MCP tool names from trail IDs. CLI flags from schema fields. Exit codes from error classes. HTTP verbs from intent. If the authored input exists, the projection is unambiguous. "Derive" is the verb for what the framework does. "Projected" is the category for the deterministic output.

**Enforced.** Constrained by the type system at compile time. Output schemas bind the return type. The Result type eliminates throw/catch. Context types scope what the implementation can access. The compiler rejects non-compliance.

**Inferred.** Detected by static analysis, best-effort. Which trails a trail follows, which error types are returned. Useful for governance, but not compiler-guaranteed.

**Observed.** Learned from runtime. The tracing system captures what actually happens: execution duration, error distributions, latency profiles, usage patterns. Observations close the loop between declared intent and actual behavior.

**Overridden.** When derivation doesn't fit. Any projected value can be explicitly set. Overrides are escape hatches, visible in the resolved graph. If you're overriding everything, the derivation rules are wrong.

### The drift guard

For any proposed feature, run through this checklist in order:

1. Can the framework derive it instead of requiring authoring? Prefer derivation.
2. If authored, does the compiler catch inconsistency? Prefer compile-time safety.
3. If not, does testing against examples catch it? Prefer test-time safety.
4. If not, does the warden catch it? Prefer lint-time safety.
5. If not, does diffing the resolved graph catch it? Prefer diff-time safety.
6. If none of the above, is it truly freeform? Freeform is acceptable only for metadata.

If a feature requires the developer to author information the framework already has, that's a framework bug. If the authored information can drift from reality and nothing catches it, the feature needs redesign.

## Promises

These are guarantees that developers and agents can count on. They follow from the principles and are enforced by the architecture.

### Derive by default, declare to tighten, override when wrong

The framework derives everything it can from the trail contract. Author what's new. Derive what's known. Override what's wrong.

Explicit declaration is an optional upgrade that tightens the projected contract. The developer goes from "the framework figured it out" to "I'm being precise about this." Both are valid. Neither is broken.

When derivation doesn't fit, override it. Overrides are visible in the resolved graph. They're escape hatches, not workarounds.

Every tightening declaration is a place where the stated contract can drift from reality. The framework must make that drift structurally difficult (the compiler catches it), immediately visible (tests catch it), or governable (the warden catches it). If none of these catch it, the feature needs redesign.

### Trailheads are peers

CLI, MCP, HTTP, and WebSocket are equal connectors over the same topology. No trailhead is privileged. The trail doesn't know which trailhead invoked it. The execution pipeline is identical regardless of entry point.

New trailheads don't require new trail code. They derive from the contract. If a trail works on one trailhead, it works on all of them.

### Implementations are pure

Input in, Result out. No process exits, no direct console output, no trailhead-specific request or response types in domain logic. The implementation does not know which trailhead invoked it.

Purity is what makes trailhead-agnosticism possible. If an implementation touches stdout, it can't run on MCP. If it reads from a request object, it can't run on CLI. Side effects happen through structured, trailhead-agnostic channels.

### Validate at the boundary, trust internally

The framework validates input before the implementation runs. If the implementation receives input, the input is valid. No defensive checking inside implementations. No guards for required fields.

Validation is a framework guarantee enforced once at the boundary, not a developer responsibility scattered across every function.

### The resolved graph is the story

The lockfile is the serialized topology: the compiled, resolved, deduplicated story of a Trails application. Every trail, service, event, and trailhead is a node. Relationships are edges. An agent reading just the lockfile can understand the entire system without source code.

The lockfile is generated, checked in, and CI-diffable. Drift between code and lockfile is a governance finding.

> The trailhead map provides the foundation today: trailhead map generation and semantic diffing. The full lockfile-as-resolved-graph, capturing the complete topology with all nodes and edges, is the target architecture. The principle holds now; the scope expands as the schema package matures.

## Primitives

The framework has a small set of core primitives. Everything else is either a specialization of those primitives or a projection from them.

### The set

- **`trail()`** is the unit of work. A defined path from typed input to Result output.
- **`resource()`** is the unit of infrastructure dependency, with lifecycle, health, and mock. It earned its place because typed infrastructure dependencies with lifecycle and testability could not be expressed through any existing primitive.
- **`signal()`** is the unit of notification. A schema-typed push with provenance.
- **`topo()`** assembles primitives into a queryable graph.
- **`Result`** is the universal return type. Ok or Err, never throw.
- **Layers** are cross-cutting wrappers around trail execution.
- **`cross()` / `crosses`** is the first-class compositional mechanism. `crosses` declares which trails a trail may compose, and `ctx.cross()` performs that composition at runtime. The warden verifies that declarations match actual usage.

### The bar for new primitives

The test for any proposed concept: can this be expressed as a specialization of an existing primitive? If yes, use the existing primitive. If no, the justification must be ironclad.

### The evaluation hierarchy

When the same structural pattern keeps appearing with slightly different shapes, evaluate in this order:

**Strengthen an existing primitive.** Can an existing primitive absorb this capability without losing coherence? This is always the best outcome. It compounds the value of everything that already uses that primitive.

**Codify a pattern.** If no primitive fits, does the need map to a recurring structural pattern that can be documented and reused? Patterns are cheaper than primitives. They guide usage without expanding the API trailhead.

**Introduce a new primitive.** Only when no existing primitive can absorb the concept and no pattern can express it. The new primitive must compound with the existing set. It should make every other primitive smarter, not just add to a list.

**Broaden built-in capability.** When a capability productively removes repeated ceremony across the system and compounds value across trailheads, testing, governance, and agent ergonomics, it is worth bringing in-house. This is not minimalism at all costs. It is deliberate growth with architectural discipline. The bar: a net win across the system, not just a convenience in one spot.

The history validates this hierarchy. `resource()` was introduced because typed infrastructure dependencies with lifecycle and testability could not be expressed through any existing primitive. `derivePermit()` was dropped because plain authored objects handled the same need without a new abstraction.

## Patterns

These are recurring design shapes that operationalize the principles and promises. They guide day-to-day decisions. They are not tactical notes. They are durable structural expectations that agents and humans can internalize and rely on.

### Examples are structured data

Trail examples are not documentation. They're not test fixtures. They're structured data on the trail definition that serve multiple purposes simultaneously: testing, agent guidance, schema validation, mock data, composition testing, and contract coverage.

One write, six reads. The developer authors an example. The framework reads it six different ways. This is the one-write-many-reads principle in its most concentrated form.

### Progressive disclosure of complexity

Every concept starts simple and gains precision as the developer invests. A trail starts with an input schema and a blaze function. The framework derives what it can from there. Over time, the developer tightens: an explicitly authored output schema, intent, error declarations, crossing declarations, examples, metadata. Each tightening step is optional. Each compounds with everything else.

The framework should not impose ceremony before it becomes necessary. The warden suggests the next step without blocking the current one.

### Authored defaults, overridable in context

A trail declares its defaults: intent, error behavior, crossing declarations, metadata. These are the author's stated design. The consuming context (the app, trailhead config, or a future composition layer) can override them.

The authored default documents intent. The override enables reuse. The resolved graph captures the final state. Governance can flag overrides that contradict intent.

### One graph, many views

The system is a single graph: trails, resources, signals, crossings, layers, and metadata. Different tools provide different views of the same underlying data.

Survey reveals what exists and how it connects. Guide explains how to use it. The warden reports what's missing and what's drifting. The lockfile captures the resolved state. The tracing system shows what's actually happening at runtime — live during execution, historical after the fact.

No separate data sources, no sync problems.

### Specify, satisfy, tighten

The testing and development workflow follows a progression:

- **Specify.** Define the trail with schema and examples, no implementation yet. The warden checks spec consistency.
- **Satisfy.** Write the implementation that makes examples pass.
- **Tighten.** Explicitly author the output schema, add safety markers, write error examples, extract compositions. The warden suggests improvements.

Repeat until the warden is quiet. One line tests every trail against every example.

## Posture

Trails makes deliberate choices about where it is opinionated, where it defers to standards, and how it relates to the broader ecosystem.

### Runtime-native, universally consumable

The framework uses its target runtime where doing so materially improves the development experience. The authoring side is opinionated.

The outputs are not. A CLI works in any shell. An MCP server works with any MCP client. An HTTP trailhead serves standard HTTP. The trailheads Trails produces are universally consumable through standard protocols and formats. Standards live at the boundary.

### Opinionated authoring, standard outputs

Trails is opinionated about how developers author contracts: schemas, Result types, the error taxonomy, the execution pipeline. These opinions exist because they make drift structurally harder than alignment and make one-write-many-reads possible.

Trails is unopinionated about what consumes the result. Trailheads produce standard outputs. Agents, browsers, CLIs, and other services interact with Trails apps through protocols they already understand.

### Performance is DX

Good performance is not a separate concern from good developer experience. Startup time, test execution speed, build throughput, and runtime overhead all affect how it feels to work with the framework. Trails should be fast where speed compounds into better workflows: fast tests encourage more testing, fast CLI startup encourages exploratory use, fast builds encourage smaller commits.

Performance is not pursued for benchmark vanity. It is pursued because sluggish tools erode the habits that make software good.
