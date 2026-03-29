# Trails Documentation

## Just getting started?

1. **[Why Trails](./why-trails.md)** — The problem, the approach, why contracts beat conventions
2. **[Getting Started](./getting-started.md)** — Install, define your first trail, blaze it on CLI, test it
3. **[Vocabulary](./vocabulary.md)** — The terms you'll use every day: trail, topo, blaze, follow, intent

## Building something?

- **[Architecture](./architecture.md)** — Hexagonal model, package layers, how data flows from trail to surface
- **[API Reference](./api-reference.md)** — Every public export across all packages
- **[Testing Guide](./testing.md)** — TDD with examples, `testAll()`, contract testing, surface harnesses

## Adding a surface?

- **[CLI Surface](./surfaces/cli.md)** — Flag derivation, output modes, exit codes, `--dry-run`
- **[MCP Surface](./surfaces/mcp.md)** — Tool naming, annotations, progress bridge

## Governing your codebase?

- **[Warden](../packages/warden/README.md)** — AST-based convention rules, drift detection, CI integration
- **[Schema](../packages/schema/README.md)** — Surface maps, semantic diffing, lock files

## Design decisions

- **[ADR-000: Core Premise](./adr/000-core-premise.md)** — Why contracts, why Result, why derive
- **[ADR-001: Naming Conventions](./adr/001-naming-conventions.md)** — How and why we chose every term

## What's next?

- **[Horizons](./horizons.md)** — HTTP surface, permits, mounts, tracks, and the road to v1 stable
