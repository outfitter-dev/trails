---
status: accepted
created: 2026-03-26
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0000: Core Premise — Contract-First, Surface-Agnostic Design

## Context

### Where this came from

Building with agents is genuinely enabling. You can move fast, explore ideas, and produce working software at a pace that would have seemed unrealistic a couple of years ago. But spending months building this way, I kept running into the same friction.

It's easy to write more code. It gets harder to write *maintainable* code over time. Agents do a lot of things right, but they don't have persistent memory across sessions. An agent builds the `users` routes on Monday and `billing` on Thursday. Both work. Both pass tests. But the error handling is different in each, the validation approach is different, the response envelope is shaped differently. Neither version is wrong. They just diverged — because nothing structural prevented it.

That divergence is subtle at first. It compounds. And it gets real when you want to expand to a new surface.

The thing that kicked this off was a CLI tool I built that I eventually wanted to expose as an MCP server too. The moment I started, I was restating schemas, duplicating error handling, maintaining two implementations of the same logic. Within a week, the CLI and MCP versions had drifted. Keeping them in sync became the work, not building features.

There's a meaningful delta right now between writing scripts that work and building software that's production-ready and maintainable. Tightening that gap — especially for agent-assisted development — felt like a problem worth solving.

### The approach

Lots of frameworks do individual pieces well. There are great tools for building CLIs, great tools for HTTP APIs, great tools for MCP servers. Trails doesn't try to replace any of them. It occupies a different layer: the **contract** layer that sits above implementations and below surfaces.

A trail is a typed contract — input schema, output schema, error types, examples, safety properties, composition graph — that happens to have an implementation attached. The contract is the product. The implementation is one rendering of it. CLI, MCP, HTTP, and WebSocket surfaces are others. You author the contract once. The framework projects it onto whatever surfaces you need.

The core question behind every design decision: *does this require the developer to author information the framework already has?* If yes, derive it instead.

### Why the contract layer matters more over time

Models are getting better at writing implementations. That's great. But the better they get, the more the bottleneck shifts to: defining the right capability, keeping it coherent across surfaces, making it testable, composing it with other capabilities, and sharing it safely. That's all contract work.

If an agent can write any implementation correctly, the value isn't in the code — it's in the specification that tells the code what to be. The contract is what keeps intent and behavior aligned, even across sessions, surfaces, and contributors.

### Who this is for

- **Developers** who want to define a capability once and surface it on CLI, MCP, and HTTP without maintaining parallel implementations.
- **Agents** that build more consistently when the contract tells them what to produce, rather than relying on memory of what they produced yesterday.
- **Non-developers** who can describe behavior in terms of names, examples, fields, and safety properties. That description is close to a trail definition. The only part requiring programming skill is the run function — and that's the part most amenable to agent synthesis.

This ADR captures the foundational decisions that make Trails what it is. If any of these were reversed, it would be a different framework. Everything else — naming conventions, package structure, testing patterns, tooling — follows from these.

## Decision

### The trail is the product

A trail definition is not a wrapper around an implementation. It's the source of truth. Surfaces (CLI, MCP, HTTP, WebSocket) are renderings of the trail contract, not separate implementations. One trail, many surfaces, zero divergence.

This means:

- CLI commands are derived from trail schemas, not manually defined
- MCP tool definitions are derived from trail schemas, not manually defined
- HTTP routes, OpenAPI specs, agent guidance, documentation — all derived
- If the trail changes, every surface changes automatically

When implementations are maintained per-surface, APIs drift from documentation, CLIs drift from HTTP endpoints, and agent tool definitions drift from both. The single-contract approach makes this drift structurally difficult.

### One schema, one Result, one error taxonomy

Every trail has one input schema and one output schema. Every implementation returns one `Result` type. Every error is a `TrailsError` with a category that maps deterministically to every surface's error representation.

- `NotFoundError` → HTTP 404, CLI exit code 1, JSON-RPC -32001 — always, everywhere
- `ValidationError` → HTTP 400, CLI exit code 2, JSON-RPC -32602 — always, everywhere

The mapping is framework knowledge, not developer knowledge. The developer returns `Result.err(new NotFoundError(...))`. The framework handles the rest.

This eliminates an entire class of inconsistency: the error behavior on one surface differing from another. The error taxonomy is the single source of truth.

### Surfaces are peers

CLI is not the primary surface with MCP as an afterthought. MCP is not the primary surface with CLI as a debug tool. All surfaces are equal adapters over the same topo. They derive from the same contracts, share the same validation, and map the same error taxonomy.

A trail author writes one implementation. It runs on every surface without modification. The trail doesn't know and doesn't care which surface invoked it.

### Implementations are pure

Input in, `Result` out. No `process.exit()`. No `console.log()`. No `Request` or `Response` objects. No surface-specific types in domain logic.

This is what makes surface-agnosticism possible. If an implementation touches `stdout`, it can't run on MCP. If it reads from `Request`, it can't run on CLI. Purity is the boundary that enables universality.

Side effects happen through structured channels: `ctx.follow()` for composition, `ctx.logger` for logging, `ctx.progress` for progress reporting. All surface-agnostic.

### Validate at the boundary, trust internally

Zod validates input before the implementation runs. If the implementation receives `input`, the input is already valid. No defensive checking inside implementations. No `if (!input.name)` guards for required fields.

This moves validation from a developer responsibility scattered across every function to a framework guarantee enforced once at the boundary. It also means examples can be validated statically — the warden checks that example inputs parse against the schema before any code runs.

### Derive by default, override deliberately

The framework derives everything it can from the trail contract:

- CLI flags from input schema fields
- MCP tool names from trail IDs
- Command grouping from dot-separated IDs
- Safety annotations from intent
- Documentation from descriptions and examples
- Test assertions from examples

The developer overrides only when the derivation is wrong for their case. The default path is zero-config.

This is the core ergonomic principle. The trail contract contains enough information to produce a full CLI, a full MCP server, a full set of tests, and a full governance report. The developer authored one thing and the framework derived the rest.

### Examples are structured data

Trail examples are not documentation. They're not test fixtures. They're **structured data** on the trail definition:

```typescript
examples: [
  { input: { name: 'Alpha' }, expected: { name: 'Alpha', type: 'concept' } },
  { input: { name: 'nonexistent' }, expectErr: NotFoundError },
];
```

Because they're structured, they serve multiple purposes simultaneously:

- **Testing:** `testExamples(topo)` runs every example as an assertion
- **Documentation:** Agents and developers read examples to understand behavior
- **Validation:** The warden checks that examples parse against schemas
- **Mock data:** Testing infrastructure derives mocks from example data
- **Composition testing:** Failure injection references examples from followed trails
- **Contract coverage:** The warden reports which behaviors have examples and which don't

One write, many reads. The developer authors an example. The framework reads it six different ways.

### The contract is queryable

The topo isn't just a collection. It's a queryable graph:

- `survey` introspects the full topology — trails, schemas, examples, follow graph, intent and metadata
- `warden` governs the topology — lint rules, drift detection, coaching suggestions
- `guide` generates guidance from the topology — documentation, agent instructions, API references
- Surface map generation captures the full contract as a diffable, hashable artifact

Agents and tooling can inspect the system without running it. An agent connecting to an unfamiliar topo can discover what's available, what inputs are expected, what outputs to anticipate, and what errors to handle — all from the contract, before making a single call.

### Author, derive, declare — guard against drift

Every feature in the framework passes through three questions:

- **Author:** Is it easy to get right? Can a novice produce correct output?
- **Derive:** Can the framework extract maximum value from what was authored?
- **Declare:** When the contract is tightened, can the declaration drift from reality?

The third question is the hardest. Output schemas, error declarations, `follow` graphs, intent, metadata, examples — each is a place where the stated contract can diverge from behavior. The framework makes divergence structurally difficult (compiler catches it), immediately visible (tests catch it), or governable (warden catches it).

If none of these catch it, the feature needs redesign.

### The information architecture

There's a real difference between "the framework computed this deterministically" and "the framework inferred this from your code." Every piece of information in the system falls into one of six categories:

- **Authored.** New information only the developer knows. Zod schemas, intent, metadata, examples, the run function, trail IDs. Creative contributions that can't be derived because they don't exist until someone writes them.
- **Projected.** Mechanically derived, guaranteed correct. MCP tool name from app name + trail ID. CLI flags from Zod fields. Exit codes from error classes. If the authored input exists, the projection is unambiguous.
- **Enforced.** Constrained by the type system at compile time. Output schemas bind the return type. `Result<T, Error>` eliminates throw/catch. `TrailContext` scopes what the implementation can access. The compiler rejects non-compliance.
- **Inferred.** Detected by static analysis, best-effort. Which trails a trail follows (from `ctx.follow()` calls). Which error types are returned (from `Result.err()` patterns). The warden uses inference to verify declarations match actual code. Useful for governance, but not compiler-guaranteed.
- **Observed.** Learned from runtime. The crumbs system captures what actually happens: execution duration, error distributions, latency profiles, usage patterns. Observations close the loop between declared intent and actual behavior.
- **Overridden.** When derivation doesn't fit. Any derived value can be explicitly set. Override the CLI command name when the default doesn't read well. Overrides are escape hatches — if you're overriding everything, the derivation rules are wrong.

**The design heuristic:** when evaluating any new feature, ask "does this require the developer to author information the framework already has?" If yes, derive it. If it genuinely can't be derived, it earns a place on the trail spec. If it can be derived but might sometimes be wrong, derive it with an override.

### Bun-native, universally consumable

The framework uses Bun where it improves the developer experience: `Bun.file()`, `Bun.write()`, `Bun.Glob`, `bun:test`, `bun:sqlite`. The development experience is Bun-first.

But the surfaces Trails produces are universally consumable. A CLI built with Trails works in any shell. An MCP server built with Trails works with any MCP client. An HTTP surface (future) serves standard HTTP. The runtime is opinionated; the outputs are standard.

## Consequences

### Positive

- **Define once, surface everywhere.** One trail definition produces CLI commands, MCP tools, HTTP endpoints, WebSocket handlers, documentation, tests, and governance checks.
- **Drift-resistant contracts.** Schema changes propagate to all surfaces. Error behavior is consistent. Examples stay in sync because they're on the definition, not in separate files.
- **Agent-native development.** Agents can inspect, consume, and build with Trails because the contract is queryable, typed, and self-documenting.
- **Progressive tightening.** Start with examples and a run function. Add output schemas. Add intent. Add error declarations. Each step tightens the contract without rewriting anything.

### Tradeoffs

- **No surface-specific logic in implementations.** If a trail needs to behave differently on CLI vs MCP, that logic lives in layers or surface adapters, not in the implementation.
- **Zod is the schema language.** The framework is built on Zod for schema definition. Swapping to a different schema library would be a major rearchitecture.
- **Result is mandatory.** Implementations return Result, not exceptions. This is a hard requirement, not a suggestion. The warden enforces it.
- **Bun is the development runtime.** The framework uses Bun APIs. Running in Node.js is not a goal (though the surfaces Trails produces are runtime-agnostic).

### What this does NOT decide

- Specific API names (see [ADR-001: Naming Conventions](0001-naming-conventions.md))
- Package boundaries beyond the current structure
- Which surfaces ship in v1 vs later
- Hosting, deployment, or runtime service architecture (`trailblaze` is future)

## References

- [ADR-0001: Naming Conventions](0001-naming-conventions.md) — naming rules derived from these principles
- [API Reference](../api-reference.md) — the canonical public API surface
- [Vocabulary](../vocabulary.md) — the Trails vocabulary guide
- [Architecture](../architecture.md) — system architecture
- [Why Trails](../why-trails.md) — the motivation behind the framework
