# Trails Library

## New to Trails?

1. **[Why Trails](./why-trails.md)** — The problem, the approach, why contracts beat conventions
2. **[Getting Started](./getting-started.md)** — Install, define your first trail, open a CLI trailhead, test it
3. **[Vocabulary](./vocabulary.md)** — The terms you'll use every day: trail, blaze, topo, trailhead, cross, provision, signal, gate, tracker

## Building something?

- **[Architecture](./architecture.md)** — Hexagonal model, package gates, how data flows from trail to trailhead
- **[API Reference](./api-reference.md)** — Every public export across all packages
- **[Provisions Guide](./services.md)** — Define dependencies, declare them on trails, test with mock factories
- **[Testing Guide](./testing.md)** — TDD with examples, `testAll()`, contract testing, trailhead harnesses

## Adding a trailhead?

- **[CLI Trailhead](./trailheads/cli.md)** — Flag derivation, output modes, exit codes, `--dry-run`
- **[MCP Trailhead](./trailheads/mcp.md)** — Tool naming, annotations, progress bridge
- **[HTTP Trailhead](./trailheads/http.md)** — Route derivation, verb mapping, error responses, Hono connector

## Governing your codebase?

- **[Warden](../packages/warden/README.md)** — AST-based convention rules, drift detection, CI integration
- **[Schema](../packages/schema/README.md)** — Trailhead maps, semantic diffing, lock files

## Design decisions

- **[ADR-0000: Core Premise](./adr/0000-core-premise.md)** — Why contracts, why Result, why derive
- **[ADR-0001: Naming Conventions](./adr/0001-naming-conventions.md)** — How and why we chose every term
- **[ADR-0002: Built-In Result Type](./adr/0002-built-in-result-type.md)** — Own the Result primitive, zero dependencies
- **[ADR-0003: Unified Trail Primitive](./adr/0003-unified-trail-primitive.md)** — One `trail()`, composition as a property
- **[ADR-0004: Intent as a First-Class Property](./adr/0004-intent-as-first-class-property.md)** — One field drives all trailhead behavior
- **[ADR-0005: Framework-Agnostic HTTP Route Model](./adr/0005-framework-agnostic-http-route-model.md)** — `HttpRoute[]` with thin connector subpaths
- **[ADR-0006: Shared Execution Pipeline](./adr/0006-shared-execution-pipeline.md)** — One `executeTrail`, Result-returning builders
- **[ADR-0007: Governance as Trails](./adr/0007-governance-as-trails.md)** — Warden rules are trails, AST-based analysis
- **[ADR-0008: Deterministic Trailhead Derivation](./adr/0008-deterministic-trailhead-derivation.md)** — Explicit lookup tables for every trailhead
- **[ADR-0009: First-Class Provisions](./adr/0009-first-class-provisions.md)** — Dependency declarations, lifecycle, testing, governance

## Where to next?

- **[Horizons](./horizons.md)** — HTTP trailhead, permits, mounts, tracker, and the road to v1 stable
