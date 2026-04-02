---
id: 10
slug: native-infrastructure
title: Trails-Native Infrastructure Pattern
status: accepted
created: 2026-03-30
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0010: Trails-Native Infrastructure Pattern

## Context

### The missing right side

The hexagonal architecture has a clear story on the left. Trailheads — CLI, MCP, HTTP, WebSocket — adapt inbound requests to trail contracts via `trailhead()`. Each is a peer rendering of the same topo. That side is solved.

The right side — logging, storage, telemetry, auth — had no primitive until ADR-0009 introduced provisions. Before that, every trail that talked to infrastructure created its own connections inline. No lifecycle, no governance, no testability.

`@ontrails/logging` established the connector pattern before provisions existed: abstract API (`Logger`) → extension point (`LogSink`) → built-in implementations → subpath connectors (`/logtape`). It works, but it's hand-wired. There's no standard way to manage its lifecycle, compose it with execution, or mock it in tests. Provisions generalize what logging pioneered.

### The production readiness layer

Three infrastructure capabilities form the "production readiness" layer:

- **Config** — environment-aware configuration resolution
- **Permits** — authentication and authorization
- **Tracker** — observability and telemetry

These aren't independent. Config resolves first — it tells permits which auth provider to use and tracker where to send telemetry. Permits checks identity before trails run. Tracker observes everything. The dependency chain is: config → permits → tracker.

Each needs the same three constructs. A **service** for lifecycle — create the auth client, cache it, dispose it, health-check it, mock it. A **layer** for cross-cutting execution wrapping — check permissions before every trail, record spans around every trail. And **trails** for inspectable operations — `config.explain` to show resolved config, `auth.verify` to check a token, `tracker.status` to report telemetry health.

### The pattern gap

ADR-0009 gives us the provision primitive. But it doesn't prescribe how infrastructure packages combine provisions, gates, and trails into a cohesive unit. Without a shared pattern, each package will invent its own shape. Config will wire differently from permits, which will wire differently from tracker. That's the drift this framework exists to prevent.

## Decision

### The provision + gate + trails trifecta

Every infrastructure package ships three kinds of primitives:

| Primitive | Purpose | Config example | Permits example | Tracker example |
|---|---|---|---|---|
| **Provision** | Lifecycle (create, cache, dispose, health, mock) | `configProvision` | `authProvision` | `trackerProvision` |
| **Gate** | Cross-cutting execution wrapping | `configGate` | `authGate` | `trackerGate` |
| **Trail** | Inspectable operations (`intent: 'read'` in v1) | `config.explain` | `auth.verify` | `tracker.status` |

Provisions manage the connector lifecycle. Gates inject behavior into the execution pipeline. Trails expose infrastructure operations as first-class contracts — queryable, testable, governable.

The trifecta is the unit of infrastructure. If a package ships a service without a layer, the cross-cutting concern isn't integrated. If it ships a layer without trails, the operations aren't inspectable. All three, every time.

### Infrastructure trails live in the same topo

Infrastructure trails aren't a separate topo. They register alongside business trails in the same app topo. Separation happens through metadata:

```typescript
const explain = trail('config.explain', {
  intent: 'read',
  metadata: { category: 'infrastructure' },
  // ...
});
```

This means:

- **Survey reports them.** An agent connecting to the topo sees both business and infrastructure capabilities.
- **`testAll` covers them.** Infrastructure examples run alongside business examples. One line validates the entire system.
- **Warden governs them.** The same rules apply — no throws, Result returns, crossing declarations match usage.
- **Trailheads can filter them.** A trailhead that wants to hide infrastructure trails filters on `metadata.category`. The default is to expose everything.

The alternative — a separate infrastructure topo — fragments the graph. Follow chains can't cross topo boundaries. Survey would need to merge multiple topos. The warden would need to run twice. One topo, one graph, one governance pass.

### Two-phase bootstrap

Infrastructure has a bootstrap problem. Config resolution runs before `executeTrail` exists — you need config to know which database to connect to, but you need the execution pipeline to run config trails. Circular.

The solution is two phases:

1. **Bootstrap phase.** Config resolves from static sources — TypeScript config files, environment variables, `.trails/config/` overrides. No trails involved. This produces the resolved config that provisions need to create.
2. **Execution phase.** The topo is built. Services are registered. Now `config.explain`, `auth.verify`, and other infrastructure trails are available through the normal execution pipeline.

Bootstrap is pure resolution — no side effects, no trail execution, no gates. It runs once at startup. Everything after bootstrap goes through `executeTrail`.

### The workspace directory

Trails establishes `.trails/` as the workspace directory for framework state:

```text
.trails/
├── config/          — local overrides (gitignored)
├── dev/             — development state (gitignored)
├── generated/       — derived artifacts
└── trailhead.lock     — committed
```

Auto-created on first framework operation. The framework generates a `.gitignore` inside `.trails/` that excludes `config/` and `dev/`. `generated/` and `trailhead.lock` are committed — they're derived artifacts that should be diffable and reviewable.

The workspace gives infrastructure a known home. Config reads overrides from `.trails/config/`. Dev tooling writes state to `.trails/dev/`. Generated trailhead maps land in `.trails/generated/`. No more scattering framework files across the project root.

### Connectors are the integration point

Each infrastructure package ships a zero-dependency built-in and optional connectors as subpath exports:

- **Config:** TypeScript config + env resolution built-in. No connectors needed in v1 — the built-in covers the common case.
- **Permits:** JWT/JWKS verification built-in. Connectors: `/openauth`, `/better-auth`, `/clerk` for provider-specific integration.
- **Tracker:** `bun:sqlite` dev store built-in — records spans locally for development inspection. Connectors: `/otel` for OpenTelemetry export.

Connectors carry optional peer dependencies. Installing `@ontrails/permits` doesn't pull in Clerk's SDK. Installing `@ontrails/permits/clerk` does.

The built-in for each package is functional enough for development and simple production cases. Connectors are for teams that need specific providers. This follows the logging precedent: `@ontrails/logging` works out of the box, `/logtape` is there when you need it.

### `testAll(app)` just works

The mock factory pattern from ADR-0009 makes zero-config testing possible for every infrastructure service:

- Config resolves a test loadout — minimal, deterministic, no env vars required.
- Auth mints synthetic permits — valid tokens with minimal claims, enough to pass `authGate` without a real provider.
- Tracker records to an in-memory store — spans are captured and queryable in assertions, nothing leaves the process.

```typescript
testAll(app); // infrastructure provisions auto-mock, business trails run against mocks
```

No setup. No test config files. No mock wiring. The provision definitions carry their own mock factories. `testAll` resolves them automatically. This is the ADR-0009 promise delivered across the entire infrastructure layer.

### Sequential ADR approval

Config, permits, and tracker ship as separate ADRs in dependency order:

1. **Config locks first.** It's the foundation — permits and tracker depend on resolved config. Building it pressure-tests the provision + gate + trails trifecta against a real use case.
2. **Permits locks after config ships.** Auth depends on config for provider selection. Building it after config validates that provisions can depend on other provisions.
3. **Tracker locks after permits ships.** Observability wraps everything, including auth checks. Building it last means the full execution pipeline is stable.

Each ADR can refine the shared pattern based on what the previous package learned. Config might reveal that the bootstrap phase needs adjustment. Permits might reveal that gates need richer context. Shipping sequentially is slower but produces a more honest pattern — one tested against real constraints, not theoretical ones.

## Consequences

### Positive

- **Every infrastructure package follows the same shape.** Provision + gate + trails. Developers learn the pattern once. New infrastructure packages follow the template.
- **Infrastructure gets the full framework contract for free.** Examples, trailheads, governance, survey reporting — all derived from the same trail primitives business logic uses.
- **`testAll` validates the entire system in one call.** Infrastructure mocks are on the provision definitions. No test harness, no setup files, no per-package configuration. When a provision lacks a mock, `testAll` skips trails that depend on it and reports which provisions blocked which trails — clear guidance, not a silent pass or a cryptic failure.
- **The workspace is a known home for framework state.** No more ad-hoc dotfiles in the project root. Config, dev state, and generated artifacts have predictable locations.

### Tradeoffs

- **More trails in the topo.** Infrastructure trails share the namespace with business trails. A topo with 20 business trails and 3 infrastructure packages might have 30+ entries. Metadata-based filtering handles this, but the topo is busier.
- **Two-phase bootstrap adds a concept.** Developers need to understand that config resolution happens before the execution pipeline exists. The boundary is clear — bootstrap is static resolution, everything else is `executeTrail` — but it's one more thing to know.
- **Sequential approval means permits and tracker may evolve.** Locking config first means the pattern is tested against one case. Permits and tracker might need adjustments that feed back into the shared pattern. This is acceptable — better to learn and adjust than to lock all three on theory.
- **Mock factories require real effort for external-system provisions.** Provisions wrapping databases, APIs, or hardware have no free in-memory equivalent. Even a thin stub returning canned `Result.ok` values is enough to validate trail wiring and unlock `testAll` coverage — full behavioral fidelity is a separate investment. The warden flags provisions without mock factories so the gap is visible, not hidden.

### What this does NOT decide

- **Which specific connectors ship first.** The connector list above is directional. Actual connector selection depends on user demand and the packages available at build time.
- **Request-scoped provision support.** Per-request auth context, per-request trace spans — these need request-scoped provisions, which are deferred per ADR-0009. The singleton model handles the connector lifecycle; request-scoped state flows through gates and context extensions.
- **Runtime declaration validation.** Tracker observing that a `read`-intent trail actually writes to a database is powerful but requires runtime instrumentation. Deferred.
- **Mock scaffolding and capture-based mock generation.** Running a trail against real provisions and recording response shapes at the provision boundary could seed mock factories automatically. This is a tooling concern — the framework records, tooling generates — and is deferred to a future ADR or CLI feature.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — "the trail is the product," "derive by default," and the information architecture that infrastructure trails inherit
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) — the `executeTrail` pipeline that infrastructure gates compose into
- [ADR-0007: Governance as Trails](0007-governance-as-trails.md) — the warden model that governs infrastructure trails alongside business trails
- [ADR-0009: Provisions as a First-Class Primitive](0009-first-class-provisions.md) — the provision primitive that infrastructure packages build on
