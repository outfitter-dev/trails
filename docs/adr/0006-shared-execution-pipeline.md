---
id: 6
slug: shared-execution-pipeline
title: Shared Execution Pipeline with Result-Returning Builders
status: accepted
created: 2026-03-29
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0006: Shared Execution Pipeline with Result-Returning Builders

## Context

Early implementations had each surface running its own execution path. CLI validated input, created a context, composed layers, ran the implementation, and wrapped errors. MCP did the same — slightly differently. HTTP would have done it a third time. Each surface reimplemented the same pipeline with small variations that became real problems.

The variations were subtle enough to miss in review but visible enough to confuse users. One surface validated input before composing layers. Another composed layers first. Error wrapping differed: CLI would catch an exception and format it as a user-facing message, MCP would catch the same exception and produce a different JSON-RPC error shape. The behavior gap widened every time someone touched one surface without updating the others.

This is exactly the kind of drift the framework exists to prevent. If the trail is the product and surfaces are renderings, the execution path that turns a trail definition into a result should be shared infrastructure — not copy-pasted per surface.

A second, related problem: surface builder functions. `buildMcpTools(topo)` originally threw on setup errors like MCP tool name collisions. `buildHttpRoutes(topo)` threw on route collisions (same method + path). This meant the framework's own wiring code used exceptions for predictable, recoverable errors — directly contradicting the "Result everywhere" principle that trail implementations follow. Builders that throw force callers into try/catch at the framework boundary, which is the one place where Result should be most natural.

## Decision

### Part 1: Shared `executeTrail`

A single function in `@ontrails/core` owns the execution pipeline:

```typescript
executeTrail(trail, rawInput, options?)
```

The pipeline, in order:

1. **Validate input** — parse `rawInput` against the trail's input schema via Zod. On failure, return `Result.err(new ValidationError(...))`.
2. **Resolve context** — build `TrailContext` with logger, services, follow capability, and any surface-provided extensions.
3. **Compose layers** — wrap the implementation with the trail's declared layers, in order.
4. **Run** — execute the composed implementation with validated input and resolved context.
5. **Catch** — if the implementation throws (it shouldn't, but defensive code beats optimistic code), wrap the exception as `Result.err(new InternalError(...))`.

`executeTrail` never throws. Every outcome is a `Result`. Every surface gets identical validation order, identical layer composition, identical error wrapping.

All four surfaces use it:

- **CLI:** parse argv into raw input → `executeTrail` → format output for terminal
- **MCP:** parse JSON-RPC params into raw input → `executeTrail` → format output as JSON-RPC response
- **HTTP:** parse request body/params into raw input → `executeTrail` → format output as HTTP response
- **Headless (`dispatch`):** accept raw input directly → `executeTrail` → return Result

Each surface is a thin wrapper: parse surface-specific input, call `executeTrail`, format surface-specific output. The execution semantics — validation, layers, error handling — are framework concerns, not surface concerns.

### Part 2: Result-returning builders

Surface builder functions return `Result` instead of throwing:

```typescript
buildMcpTools(topo)   → Result<McpToolDefinition[], Error>
buildHttpRoutes(topo) → Result<HttpRouteDefinition[], Error>
```

`buildMcpTools` returns `ValidationError` when two trails produce the same MCP tool name. `buildHttpRoutes` returns `ValidationError` when two trails map to the same method + path combination.

Setup errors are surfaced before the server starts, not at request time. A caller that checks the Result at boot gets a clear, typed error explaining the collision — which trails conflict, what the derived name was, and what to do about it. No stack trace, no catch block, no ambiguity about whether the error is recoverable.

This extends the Result model from runtime execution to framework wiring. The same error-handling pattern works from boot to shutdown: check the Result, branch on success or failure, handle errors with full type information.

`blaze()` — the one-liner that collapses build + wire into a single call — handles the Result internally. If the build fails, `blaze` logs the error and exits (CLI) or returns a startup failure (programmatic). The Result is there for developers who use the two-step `build*` → `to*` escape hatch and want explicit control.

## Consequences

### Positive

- **Behavioral consistency.** Every surface validates, composes layers, and wraps errors in exactly the same order. A bug fix in `executeTrail` fixes all surfaces simultaneously.
- **One place for cross-cutting concerns.** Logging, tracing, metrics, and any future observability hooks have a single integration point. No per-surface instrumentation.
- **Setup errors caught early.** Name collisions and route conflicts surface at boot, not when the first request hits a confusing runtime error.
- **Result from boot to shutdown.** The framework's own wiring code follows the same error-handling pattern it requires of trail implementations. No philosophical inconsistency between "your code returns Result" and "our code throws."

### Tradeoffs

- **`executeTrail` is a critical path.** Every trail invocation across every surface flows through this function. A regression here affects everything. This is acceptable because the alternative — four independent execution paths — is where regressions hide, not where they're prevented.
- **Surface-specific optimizations are constrained.** If a surface needs to skip validation (e.g., internal-only calls with pre-validated input), it needs an explicit opt-in on the options parameter rather than just omitting the validation step. This is a feature, not a bug — skipping validation should be deliberate and visible.

### What this does NOT decide

- Whether `executeTrail` will gain middleware or interceptor hooks beyond the current layer model. Layers handle most cross-cutting concerns today. If that proves insufficient, a separate ADR will address it.
- The specific options surface on `executeTrail` beyond the current parameters. The function signature will grow as needs emerge.
- How `blaze()` handles builder failures in non-CLI contexts (e.g., programmatic embedding). That's a surface-level UX decision.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — the foundational decisions this pipeline serves, especially "implementations are pure" and "surfaces are peers"
- [ADR-0002: Built-In Result Type](0002-built-in-result-type.md) — the Result model that `executeTrail` and builders both return
- [ADR-0005: Framework-Agnostic HTTP Route Model](0005-framework-agnostic-http-route-model.md) — the route derivation model that `buildHttpRoutes` implements
