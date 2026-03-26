# Trails — Overview

**Trails is an agent-native, contract-first framework for building software.** Define your logic once as typed trails with Zod schemas. Surface them on CLI, MCP, HTTP, or WebSocket — one line each. The rest is on Trails.

## Agent-Native

Agent-native means two things:

**Building with Trails.** Agents produce correct, consistent software by default. The architecture makes drift structurally harder than alignment — one schema, one error taxonomy, one Result type across every surface. An agent can't create inconsistent flag names or divergent error handling because there's only one source of truth.

**Consuming Trails apps.** Agents get queryable contracts, typed schemas, structured errors, examples, and recovery paths. Everything they need to plan, execute, and recover — without parsing help text or guessing at flag names.

## The Three Primitives

```typescript
import { trail, route, event } from '@ontrails/core';
```

**`trail()`** — The atomic unit. A typed function with a Zod schema, returning `Result`. The trail is the contract.

**`hike()`** — A composite that follows multiple trails. Declares what it traverses via `follows`. Has its own schema.

**`event()`** — A server-originated push. Carries a Zod schema for the data shape. No implementation — things happen and this is the announcement.

## The Flow

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { blaze } from '@ontrails/cli/commander';
import { z } from 'zod';

// 1. Define trails
const show = trail('entity.show', {
  input: z.object({ name: z.string() }),
  readOnly: true,
  implementation: (input) => Result.ok({ name: input.name, type: 'concept' }),
});

// 2. Collect into a topo
import * as entity from './trails/entity';
const app = topo('myapp', entity);

// 3. Blaze on surfaces
blaze(app); // CLI — every trail becomes a command
```

Add MCP:

```typescript
import { blaze as blazeMcp } from '@ontrails/mcp';
blazeMcp(app, { stdio: true });
```

Same trails. Same implementation. Every surface. Pure trails can be authored synchronously; the runtime still normalizes execution to one awaitable shape for every surface.

## Examples Are Tests

When you add `examples` to a trail, you're writing documentation for agents AND a test suite:

```typescript
const search = trail('search', {
  input: z.object({ query: z.string(), limit: z.number().default(10) }),
  output: z.array(ResultSchema),
  readOnly: true,
  examples: [
    {
      description: 'Basic search',
      input: { query: 'auth' },
      output: [{ id: '1', content: 'JWT auth' }],
    },
    {
      description: 'Empty result is ok',
      input: { query: 'nonexistent' },
      output: [],
    },
  ],
  implementation: searchImpl,
});
```

Those examples serve six consumers at once:

| Consumer | What it does with examples |
| --- | --- |
| **`testExamples(app)`** | Runs every example as a test — validates input, runs implementation, asserts output |
| **Agents (via MCP)** | Learns concrete input/output shapes by example |
| **Agents (via survey)** | Sees what the trail does with real data |
| **Guide** | Generates usage documentation |
| **MCP Apps** | Pre-fills forms with example inputs |
| **Warden** | Verifies examples parse against schemas |

One line tests the entire app:

```typescript
import { testExamples } from '@ontrails/testing';
testExamples(app, testContext);
```

You never write a separate test file for the happy path. The examples ARE the tests. Write them for agent fluency — get test coverage for free.

## Packages

| Package | Purpose |
| --- | --- |
| `@ontrails/core` | Foundation — Result, errors, trail/hike/event, patterns, types, validation |
| `@ontrails/cli` | CLI surface adapter + `/commander` subpath |
| `@ontrails/mcp` | MCP surface adapter |
| `@ontrails/logging` | Structured logging + `/logtape` adapter |
| `@ontrails/testing` | Contract-driven testing — `testExamples()` |
| `@ontrails/schema` | Surface maps, diffing, governance |

## npm Scope

`@ontrails` — as in "the rest is on Trails."

## Website

`trails.dev` (docs) / `trails.sh` (CLI, short links)
