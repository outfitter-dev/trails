# Trails

**Define once. Surface everywhere. The rest is on Trails.**

Trails is an agent-native, contract-first TypeScript framework. Define your logic once as typed trails with Zod schemas. Surface them on CLI, MCP, HTTP, or WebSocket -- one line each.

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { z } from 'zod';

// Define a trail
const greet = trail('greet', {
  input: z.object({
    name: z.string().describe('Who to greet'),
  }),
  output: z.object({ message: z.string() }),
  readOnly: true,
  examples: [
    {
      name: 'Basic greeting',
      input: { name: 'World' },
      expected: { message: 'Hello, World!' },
    },
  ],
  implementation: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

// Collect into an app
const app = topo('myapp', { greet });

// Blaze on CLI
import { blaze } from '@ontrails/cli/commander';
blaze(app);

// Blaze on MCP -- same trails, same implementation
import { blaze as blazeMcp } from '@ontrails/mcp';
await blazeMcp(app);
```

```bash
$ myapp greet --name World
{ "message": "Hello, World!" }
```

Same trails. Same implementation. Every surface. Pure trails can return `Result` directly; hikes and I/O-bound trails can stay `async`. Trails normalizes both forms to one awaitable runtime shape before layers and surfaces execute them.

## Features

- **One schema, every surface.** CLI flags, MCP tool definitions, HTTP query params, and `--help` text are all generated from a single Zod schema.
- **Result types, not exceptions.** `Result<T, Error>` replaces throw/catch. 13 error classes across 10 categories, each mapping to exit codes, HTTP status, and retryability.
- **Examples are tests.** Add `examples` to a trail and `testExamples(app)` runs them as assertions. Write for agent fluency, get test coverage for free.
- **Derive the default, override when wrong.** Command names, tool names, flag names -- all derived from the trail ID and Zod schema. Zero configuration for the common case.
- **Agent-native for building AND consuming.** Structural constraints make agent-built tools consistent by default. Queryable contracts make agent-consumed tools effective by default.
- **Hexagonal architecture.** Core defines ports. Surfaces (CLI, MCP) and infrastructure (logging, storage) are adapters. No vendor lock-in.
- **Bun-native framework.** Surfaces are universally consumable -- CLI binaries, MCP servers, and HTTP endpoints work with any runtime on the consuming side.

## Packages

| Package | Description |
| --- | --- |
| [`@ontrails/core`](./packages/core) | Foundation -- Result, errors, trail/hike/event, topo, patterns, redaction, branded types, validation |
| [`@ontrails/cli`](./packages/cli) | CLI surface adapter + `/commander` subpath for flag derivation, output formatting, `blaze()` |
| [`@ontrails/mcp`](./packages/mcp) | MCP surface adapter -- tool generation, annotations, progress bridge, `blaze()` |
| [`@ontrails/logging`](./packages/logging) | Structured logging -- `createLogger()`, sinks, formatters, hierarchical filtering, `/logtape` adapter |
| [`@ontrails/testing`](./packages/testing) | Contract-driven testing -- `testExamples()`, `testTrail()`, `testHike()`, `testContracts()`, surface harnesses |
| [`@ontrails/schema`](./packages/schema) | Surface maps, semantic diffing, lock files for CI governance |
| [`@ontrails/warden`](./packages/warden) | Lint rules, drift detection, contract enforcement |

## Quick Start

```bash
# Recommended: scaffold a new project
bunx trails init

# Or install manually
bun add @ontrails/core @ontrails/cli

# Add Commander adapter (for the /commander subpath)
bun add commander

# Add MCP surface (optional)
bun add @ontrails/mcp

# Add testing (dev)
bun add -d @ontrails/testing
```

Define a trail:

```typescript
// src/trails/entity.ts
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

export const show = trail('entity.show', {
  input: z.object({ name: z.string().describe('Entity name') }),
  output: z.object({ name: z.string(), type: z.string() }),
  readOnly: true,
  examples: [
    {
      name: 'Show entity',
      input: { name: 'Alpha' },
      expected: { name: 'Alpha', type: 'concept' },
    },
  ],
  implementation: (input) => Result.ok({ name: input.name, type: 'concept' }),
});
```

Collect and blaze:

```typescript
// src/app.ts
import { topo } from '@ontrails/core';
import * as entity from './trails/entity';
export const app = topo('myapp', entity);

// src/cli.ts
import { blaze } from '@ontrails/cli/commander';
import { app } from './app';
blaze(app);
```

Test with one line:

```typescript
// src/__tests__/app.test.ts
import { testExamples } from '@ontrails/testing';
import { app } from '../app';
testExamples(app);
```

## The Pattern

```text
trail()      defines   --> the contract (schema, implementation, examples, metadata)
topo()       collects  --> trails into an app (builds the topo)
blaze()      surfaces  --> the app on CLI, MCP, HTTP, or WebSocket
```

## Documentation

- [Why Trails](./docs/why-trails.md) -- Philosophy, derivation model, and how it compares
- [Getting Started](./docs/getting-started.md) -- Installation, first trail, blaze, test
- [Architecture](./docs/architecture.md) -- Hexagonal model, package layers, dependency graph
- [Vocabulary](./docs/vocabulary.md) -- All Trails terms defined
- [Testing Guide](./docs/testing.md) -- TDD, `testExamples()`, contract testing, harnesses
- [CLI Surface](./docs/surfaces/cli.md) -- Flag derivation, output modes, layers
- [MCP Surface](./docs/surfaces/mcp.md) -- Annotations, progress, tool naming
- [Horizons](./docs/horizons.md) -- What the architecture unlocks next

## Development

```bash
bun run build          # Build all packages
bun run test           # Run all tests
bun run lint           # Lint with oxlint
bun run typecheck      # TypeScript type checking
bun run check          # lint + format:check + typecheck
```

---

The rest is on Trails.
