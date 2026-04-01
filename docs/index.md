# Trails Library

## New to Trails?

1. **[Why Trails](./why-trails.md)** — The problem, the approach, why contracts beat conventions
2. **[Getting Started](./getting-started.md)** — Install, define your first trail, blaze it on CLI, test it
3. **[Vocabulary](./vocabulary.md)** — The terms you'll use every day: trail, topo, blaze, follow, intent

## Building something?

- **[Architecture](./architecture.md)** — Hexagonal model, package layers, how data flows from trail to surface
- **[API Reference](./api-reference.md)** — Every public export across all packages
- **[Services Guide](./services.md)** — Define dependencies, declare them on trails, test with mock factories
- **[Testing Guide](./testing.md)** — TDD with examples, `testAll()`, contract testing, surface harnesses

## Adding a surface?

- **[CLI Surface](./surfaces/cli.md)** — Flag derivation, output modes, exit codes, `--dry-run`
- **[MCP Surface](./surfaces/mcp.md)** — Tool naming, annotations, progress bridge
- **[HTTP Surface](./surfaces/http.md)** — Route derivation, verb mapping, error responses, Hono adapter

## Governing your codebase?

- **[Warden](../packages/warden/README.md)** — AST-based convention rules, drift detection, CI integration
- **[Schema](../packages/schema/README.md)** — Surface maps, semantic diffing, lock files

## Design decisions

- **[ADR-0000: Core Premise](./adr/0000-core-premise.md)** — Why contracts, why Result, why derive
- **[ADR-0001: Naming Conventions](./adr/0001-naming-conventions.md)** — How and why we chose every term
- **[ADR-0002: Built-In Result Type](./adr/0002-built-in-result-type.md)** — Own the Result primitive, zero dependencies
- **[ADR-0003: Unified Trail Primitive](./adr/0003-unified-trail-primitive.md)** — One `trail()`, composition as a property
- **[ADR-0004: Intent as a First-Class Property](./adr/0004-intent-as-first-class-property.md)** — One field drives all surface behavior
- **[ADR-0005: Framework-Agnostic HTTP Route Model](./adr/0005-framework-agnostic-http-route-model.md)** — `HttpRoute[]` with thin adapter subpaths
- **[ADR-0006: Shared Execution Pipeline](./adr/0006-shared-execution-pipeline.md)** — One `executeTrail`, Result-returning builders
- **[ADR-0007: Governance as Trails](./adr/0007-governance-as-trails.md)** — Warden rules are trails, AST-based analysis
- **[ADR-0008: Deterministic Surface Derivation](./adr/0008-deterministic-surface-derivation.md)** — Explicit lookup tables for every surface
- **[ADR-0009: Services as a First-Class Primitive](./adr/0009-services.md)** — Dependency declarations, lifecycle, testing, governance

## Where to next?

- **[Horizons](./horizons.md)** — HTTP surface, permits, mounts, crumbs, and the road to v1 stable
