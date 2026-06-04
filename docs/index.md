# Trails Library

## New to Trails?

1. **[Why Trails](./why-trails.md)** — The problem, the approach, why contracts beat conventions
2. **[Getting Started](./getting-started.md)** — Install, define your first trail, open CLI/MCP/HTTP surfaces, test it
3. **[Lexicon](./lexicon.md)** — The terms you'll use every day: trail, blaze, topo, contour, surface, compose, resource, signal, execution layers, tracing

## Release Notes

- **[Stable Cutover Runbook](./releases/stable-cutover.md)** — Beta-to-1.0 cutover sequence, publish boundaries, and recovery checks
- **[Beta Channel Policy](./releases/beta-channel-policy.md)** — Beta install tags, `latest` posture, version cadence, and read-only registry checks
- **[Plugin Release Runbook](./releases/plugin-release.md)** — Claude plugin/skills refresh, dogfood, and manual publication checks
- **[Beta 15](./releases/beta15.md)** — Beta 15 release-prep notes and known CLI follow-up work
- **[Beta 15 to Beta 19](./releases/beta15-to-beta19.md)** — Downstream operator guide: package install, surface decisions, `cross`→`compose` rename, trail versioning, adapter authoring, Topographer adoption, validation checklist

## Building something?

- **[Architecture](./architecture.md)** — Hexagonal model, package layers, how data flows from trail to surface
- **[API Reference](./api-reference.md)** — Every public export across all packages
- **[Resources Guide](./resources.md)** — Define resources, declare them on trails, test with mock factories
- **[Store Guide](../packages/store/README.md)** — Declare schema-derived stores, bind them with Drizzle, use fixtures and read-only access
- **[Store Signal Identity Migration](./store-signal-identity-migration.md)** — Update store-derived signal ids from bare table changes to resource-scoped form
- **[Config Guide](../packages/config/README.md)** — Schema-derived configuration, resolution stack, extensions, profiles
- **[Permits Guide](../packages/permits/README.md)** — Scope-based authorization, auth adapters, permit governance
- **[Observability Guide](../packages/observe/README.md)** — Log/trace sink contracts, built-in sinks, sink composition
- **[Tracing Guide](../packages/tracing/README.md)** — Execution recording, sinks, sampling, manual instrumentation
- **[Testing Guide](./testing.md)** — TDD with examples, `testAll()`, contract testing, surface harnesses

## Adding a surface?

- **[CLI Surface](./surfaces/cli.md)** — Shipped today. Flag derivation, output modes, exit codes, `--dry-run`
- **[MCP Surface](./surfaces/mcp.md)** — Shipped today. Tool naming, annotations, progress bridge
- **[HTTP Surface](./surfaces/http.md)** — Shipped today. Route derivation, Web Fetch kernel, Hono adapter, Bun-native serving, webhook activation
- **[Surface Facet Parity](./surfaces/surface-facet-parity.md)** — Deferred CLI/HTTP parity decision after MCP proves grouped projection
- **WebSocket Surface** — Planned, not yet implemented. See [Horizons](./horizons.md) for the current direction.

## Governing your codebase?

- **[Warden](./warden.md)** — Trails correctness rules, rule-home boundaries, drift detection, CI integration
- **[Topographer](../packages/topographer/README.md)** — TopoGraphs, durable artifact helpers, semantic diffing, lock manifests, topo-store persistence

## Contributing to Trails?

- **[Contributing Guide](./contributing/README.md)** — House guides for changing the Trails repository
- **[Language Styleguide](./contributing/language-styleguide.md)** — How to write about Trails terms precisely, starting with `blaze`
- **[Code Standards](./contributing/code-standards.md)** — TSDoc, source anchors, escape-hatch criteria, and code-shape conventions
- **[Codebase Navigation](./contributing/codebase-navigation.md)** — Repo orientation, source-of-truth locations, generated files, and symbol navigation
- **[Warden Rules](./contributing/warden-rules.md)** — Methodology for durable Warden rules, owner-held rule data, and rule-family collapse

## Design decisions

- **[ADR-0000: Core Premise](./adr/0000-core-premise.md)** — Why contracts, why Result, why derive
- **[ADR-0001: Naming Conventions](./adr/0001-naming-conventions.md)** — How and why we chose every term
- **[ADR-0002: Built-In Result Type](./adr/0002-built-in-result-type.md)** — Own the Result primitive, zero dependencies
- **[ADR-0003: Unified Trail Primitive](./adr/0003-unified-trail-primitive.md)** — One `trail()`, composition as a property
- **[ADR-0004: Intent as a First-Class Property](./adr/0004-intent-as-first-class-property.md)** — One field drives all surface behavior
- **[ADR-0005: Framework-Agnostic HTTP Route Model](./adr/0005-framework-agnostic-http-route-model.md)** — `HttpRoute[]` with thin adapter packages
- **[ADR-0006: Shared Execution Pipeline](./adr/0006-shared-execution-pipeline.md)** — One `executeTrail`, Result-returning builders
- **[ADR-0007: Governance as Trails](./adr/0007-governance-as-trails.md)** — Warden rules are trails, AST-based analysis
- **[ADR-0008: Deterministic Surface Derivation](./adr/0008-deterministic-trailhead-derivation.md)** — Explicit lookup tables for every surface
- **[ADR-0009: First-Class Resources](./adr/0009-first-class-resources.md)** — Dependency declarations, lifecycle, testing, governance
- **[ADR-0010: Trails-Native Infrastructure](./adr/0010-native-infrastructure.md)** — Workspace layout, `.trails/` directory, shared database
- **[ADR-0011: Schema-Driven Config](./adr/0011-schema-driven-config.md)** — Typed configuration from schemas
- **[ADR-0012: Adapter-Agnostic Permits](./adr/0012-connector-agnostic-permits.md)** — Permission model independent of surface
- **[ADR-0013: Tracing](./adr/0013-tracing.md)** — Runtime recording primitive
- **[ADR-0014: Core Database Primitive](./adr/0014-core-database-primitive.md)** — Shared `trails.db`, subsystem schema versioning
- **[ADR-0015: Topo Store](./adr/0015-topo-store.md)** — Queryable relational projection of the resolved graph
- **[ADR-0016: Schema-Derived Persistence](./adr/0016-schema-derived-persistence.md)** — `store()` declaration, adapter binding, fixtures
- **[ADR-0017: The Serialized Topo Graph](./adr/0017-serialized-topo-graph.md)** — Lockfile as resolved graph
- **[ADR-0018: Signal-Driven Governance](./adr/0018-signal-driven-governance.md)** — Governance through signals
- **[ADR-0019: Hierarchical Command Trees](./adr/0019-hierarchical-command-trees-from-trail-ids.md)** — Full CLI path derivation from dotted trail IDs
- **[ADR-0020: Structured CLI Input](./adr/0020-flags-for-fields-structured-input-on-the-cli.md)** — Flags for fields, JSON/file/stdin channels
- **[ADR-0021: Draft State Containment](./adr/0021-draft-state-stays-out-of-the-resolved-graph.md)** — Draft state stays out of the resolved graph
- **[ADR-0022: Drizzle Binds Schema-Derived Stores to SQLite](./adr/0022-drizzle-store-connector.md)** — Drizzle binds schema-derived stores to SQLite
- **[ADR-0023: Simplifying the Trails Lexicon](./adr/0023-simplifying-the-trails-lexicon.md)** — Brand-vs-plain heuristic, four pre-1.0 renames, vocabulary → lexicon

## Migration Guides

- **[Logging to Observe](./migration/logging-to-observe.md)** — Move off the retired `@ontrails/logging` package
- **[Connector to Adapter](./migration/connector-to-adapter.md)** — Move current-facing package taxonomy to adapters
- **[Trailhead to Surface](./migration/trailhead-to-surface.md)** — Move active surface vocabulary from trailhead to surface

## Where to next?

- **[Horizons](./horizons.md)** — WebSocket, mounts, packs, guide-driven SDKs, and the post-v1 roadmap
