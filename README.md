# Trails

**Define once. Surface everywhere.**

Trails is a contract-first TypeScript framework for agent-assisted development. You define a trail — a typed contract with a Zod schema, implementation, examples, and metadata — and the framework projects it onto CLI, MCP, HTTP, or WebSocket. One definition, every surface, zero drift.

## The problem

Agents write good code, fast. But they write code that drifts.

An agent that builds `users` on Monday and `billing` on Thursday produces slightly different patterns each time — different error formats, different validation approaches, different response envelopes. Both work. Both pass tests. They just diverged, because nothing structural prevented it.

That divergence compounds. And it gets real the moment you want to add a second surface. The CLI and MCP versions of the same logic start drifting within days. Keeping them in sync becomes the work, not building features.

Trails makes drift structurally harder than alignment.

## How it works

A trail is a typed function with a contract:

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { z } from 'zod';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  output: z.object({ message: z.string() }),
  intent: 'read',
  examples: [
    { name: 'Hello', input: { name: 'World' }, expected: { message: 'Hello, World!' } },
  ],
  run: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});
```

Collect trails into a topo. Open it on any surface with `blaze()`:

```typescript
const app = topo('myapp', { greet });

// CLI
import { blaze } from '@ontrails/cli/commander';
blaze(app);

// MCP — same trails, same implementation
import { blaze as blazeMcp } from '@ontrails/mcp';
await blazeMcp(app);
```

```bash
$ myapp greet --name World
{ "message": "Hello, World!" }
```

Same contract. Same implementation. Every surface derives its representation from the trail — CLI flags from the Zod schema, MCP tool definitions from the trail metadata, error codes from the error taxonomy. The developer authored one thing. The framework derived the rest.

## What Trails does

**Author what's new. Derive what's known. Override what's wrong.**

- **One schema, every surface.** CLI flags, MCP tool definitions, and `--help` text are all derived from a single Zod schema. Change the schema, every surface updates.
- **Typed errors, not exceptions.** `Result<T, Error>` replaces throw/catch. 13 error classes map deterministically to exit codes, HTTP status, and JSON-RPC codes — on every surface, every time.
- **Examples are tests.** Add `examples` to a trail and `testAll(app)` runs them as assertions, verifies output schemas, checks composition graphs, and validates structural integrity. One line of test code, full governance.
- **The contract is queryable.** `survey` introspects the topo. `warden` governs it. `validateTopo()` checks structural validity. Agents and tooling can inspect the system without running it.
- **Bun-native.** The framework uses Bun for development. The surfaces it produces — CLI binaries, MCP servers, HTTP endpoints — work with any runtime on the consuming side.

## Quick start

```bash
bunx @ontrails/trails create
```

Follow the prompts — pick a name, choose a starter (hello world, entity CRUD, or empty), and select your surfaces (CLI, MCP, or both). The scaffolder generates a working project with trails, a topo, surface wiring, and tests.

```bash
cd my-project
bun test        # Examples run as tests
bun run cli     # Your CLI works
```

Or install manually:

```bash
bun add @ontrails/core @ontrails/cli commander zod
bun add -d @ontrails/testing
```

The [Getting Started guide](./docs/getting-started.md) walks through building your first trail from scratch.

## The vocabulary

```text
trail()        define a unit of work (with optional follow for composition)
event()        define a payload schema
topo()         assemble trails into a queryable topology
blaze()        surface the topo on CLI, MCP, HTTP, or WebSocket
```

## Packages

| Package | What it does |
| --- | --- |
| [`@ontrails/core`](./packages/core) | Result, errors, trail/event/topo, validateTopo, validation, schema derivation, patterns, branded types |
| [`@ontrails/cli`](./packages/cli) | CLI surface — flag derivation from Zod, output formatting, Commander adapter, `blaze()` |
| [`@ontrails/mcp`](./packages/mcp) | MCP surface — tool generation, annotations, progress bridge, `blaze()` |
| [`@ontrails/logging`](./packages/logging) | Structured logging — sinks, formatters, hierarchical filtering, LogTape adapter |
| [`@ontrails/testing`](./packages/testing) | `testAll()`, `testExamples()`, `testTrail()`, `testContracts()`, surface harnesses |
| [`@ontrails/schema`](./packages/schema) | Surface maps, semantic diffing, lock files for CI governance |
| [`@ontrails/warden`](./packages/warden) | AST-based code convention rules, drift detection, CI formatters |

## Documentation

- [Why Trails](./docs/why-trails.md) — The problem, the approach, the design principles
- [Getting Started](./docs/getting-started.md) — Installation, first trail, blaze, test
- [Architecture](./docs/architecture.md) — Hexagonal model, package layers, information architecture
- [Vocabulary](./docs/vocabulary.md) — Every Trails term defined
- [Testing Guide](./docs/testing.md) — TDD with examples, `testAll()`, contract testing
- [ADR-000: Core Premise](./docs/adr/000-core-premise.md) — The foundational decisions
- [ADR-001: Naming Conventions](./docs/adr/001-naming-conventions.md) — The naming rules
- [API Reference](./docs/api-reference.md) — The complete public API surface

## Development

```bash
bun run build          # Build all packages
bun run test           # Run all tests
bun run lint           # Lint with oxlint
bun run typecheck      # TypeScript strict mode
bun run check          # All of the above
```

## Status

v1 beta. The contract layer, CLI and MCP surfaces, testing infrastructure, and governance tooling are implemented and passing. HTTP and WebSocket surfaces are designed but not yet built. See [Horizons](./docs/horizons.md) for what's next.
