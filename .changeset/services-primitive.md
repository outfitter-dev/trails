---
"@ontrails/core": minor
"@ontrails/testing": minor
"@ontrails/warden": minor
"@ontrails/cli": patch
"@ontrails/mcp": patch
"@ontrails/http": patch
"@ontrails/schema": patch
"@ontrails/trails": patch
---

Add services as a first-class primitive.

Services make infrastructure dependencies declarative, injectable, and governable. Define a service with `service()`, declare it on a trail with `services: [db]`, and access it with `db.from(ctx)` or `ctx.service()`.

**Core:** `service()` factory, `ServiceSpec<T>`, `ServiceContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isService` guard, `findDuplicateServiceId`, topo service discovery and validation, `services` field on trail specs.

**Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testFollows`. Explicit `services` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Service mock propagation through follow graphs.

**Warden:** `service-declarations` rule validates `db.from(ctx)` and `ctx.service()` usage matches declared `services: [...]`. `service-exists` rule validates declared service IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

**Surfaces:** Service overrides thread through `dispatch` and `blaze` on CLI, MCP, and HTTP.

**Introspection:** Survey and surface map outputs include service graph. Topo exposes `.services`, `.getService()`, `.hasService()`, `.listServices()`, `.serviceIds()`, `.serviceCount`.

**Docs:** ADR-009 accepted. Unified services guide, updated vocabulary, getting-started, architecture, and package READMEs.
