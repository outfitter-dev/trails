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

Add provisions as a first-class primitive.

Provisions make infrastructure dependencies declarative, injectable, and governable. Define a provision with `provision()`, declare it on a trail with `provisions: [db]`, and access it with `db.from(ctx)` or `ctx.provision()`.

**Core:** `provision()` factory, `ProvisionSpec<T>`, `ProvisionContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isProvision` guard, `findDuplicateServiceId`, topo provision discovery and validation, `provisions` field on trail specs.

**Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testFollows`. Explicit `provisions` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Provision mock propagation through follow graphs.

**Warden:** `provision-declarations` rule validates `db.from(ctx)` and `ctx.provision()` usage matches declared `provisions: [...]`. `provision-exists` rule validates declared provision IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

**Trailheads:** Provision overrides thread through the CLI, MCP, and HTTP trailheads.

**Introspection:** Survey and trailhead map outputs include provision graph. Topo exposes `.provisions`, `.getProvision()`, `.hasProvision()`, `.listProvisions()`, `.provisionIds()`, `.provisionCount`.

**Docs:** ADR-009 accepted. Unified provisions guide, updated vocabulary, getting-started, architecture, and package READMEs.
