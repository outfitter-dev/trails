# @ontrails/core

The foundation of Trails. Result type, error taxonomy, trail/hike/event definitions, topo, validation, patterns, redaction, branded types, and collection utilities. One external dependency: `zod`.

## Installation

```bash
bun add @ontrails/core
```

## Quick Start

```typescript
import { trail, hike, topo, Result } from '@ontrails/core';
import { z } from 'zod';

// Define a trail -- the atomic unit of work
const show = trail('entity.show', {
  input: z.object({ name: z.string().describe('Entity name') }),
  output: z.object({ name: z.string(), type: z.string() }),
  readOnly: true,
  examples: [
    {
      name: 'Show an entity',
      input: { name: 'Alpha' },
      expected: { name: 'Alpha', type: 'concept' },
    },
  ],
  implementation: (input) => Result.ok({ name: input.name, type: 'concept' }),
});

// Define a hike -- a composite that follows other trails
const onboard = hike('entity.onboard', {
  follows: ['entity.add', 'entity.relate'],
  input: z.object({ name: z.string(), type: z.string() }),
  implementation: async (input, ctx) => {
    const added = await ctx.follow('entity.add', input);
    if (added.isErr()) return added;
    return Result.ok({ entity: added.value });
  },
});

// Collect into an app
import * as entity from './trails/entity';
const app = topo('myapp', entity);
```

Pure trails can return `Result` directly. Hikes and other I/O-bound trails can stay `async`; core normalizes both forms to one awaitable runtime shape before layers and surfaces execute them.

## API Overview

### Trail Primitives

- **`trail(id, spec)`** -- Define an atomic unit of work. Typed input via Zod, returns `Result`. Authoring may be sync or async.
- **`hike(id, spec)`** -- Define a composite that follows multiple trails via `ctx.follow()`. Declares dependencies with `follows: string[]`.
- **`event(id, spec)`** -- Define a server-originated push with a typed data schema.
- **`topo(name, ...modules)`** -- Collect trail modules into an app. Scans exports for `Trail` shapes and builds the topo.

### Result Type

Built-in `Result<T, E>` with no external dependency.

```typescript
Result.ok(value); // Create a success
Result.err(error); // Create a failure
Result.combine(results); // Collect Result<T>[] into Result<T[]>

result.isOk(); // Type guard for Ok
result.isErr(); // Type guard for Err
result.map(fn); // Transform success value
result.flatMap(fn); // Chain Result-returning functions
result.match({ ok, err }); // Pattern match
result.unwrapOr(fallback); // Value or fallback
```

Implementations return `Result`, never `throw`.

### Error Taxonomy

13 error classes across 10 categories, all extending `TrailsError`. Each maps to CLI exit codes, HTTP status codes, JSON-RPC codes, and retryability.

| Category | Classes | Exit | HTTP | Retryable |
| --- | --- | --- | --- | --- |
| `validation` | `ValidationError`, `AmbiguousError`, `AssertionError` | 1 | 400 | No |
| `not_found` | `NotFoundError` | 2 | 404 | No |
| `conflict` | `AlreadyExistsError`, `ConflictError` | 3 | 409 | No |
| `permission` | `PermissionError` | 4 | 403 | No |
| `timeout` | `TimeoutError` | 5 | 504 | Yes |
| `rate_limit` | `RateLimitError` | 6 | 429 | Yes |
| `network` | `NetworkError` | 7 | 502 | Yes |
| `internal` | `InternalError` | 8 | 500 | No |
| `auth` | `AuthError` | 9 | 401 | No |
| `cancelled` | `CancelledError` | 130 | 499 | No |

All extend `TrailsError` directly (class inheritance, no factory pattern). Pattern matching via `instanceof` or `error.category`.

### Patterns (`@ontrails/core/patterns`)

Reusable Zod schemas for common input/output shapes:

- **Pagination** -- `paginationInput`, `paginationOutput` (cursor-based)
- **Bulk operations** -- `bulkInput`, `bulkOutput` (batch with per-item results)
- **Timestamps** -- `timestamps` (`createdAt`/`updatedAt`)
- **Date ranges** -- `dateRangeInput` (`since`/`until`)
- **Sorting** -- `sortInput` (`sortBy`/`sortOrder`)
- **Status** -- `statusField` (lifecycle state)
- **Change tracking** -- `changeOutput` (before/after snapshots)
- **Progress** -- `progressOutput` (completion reporting)

### Redaction (`@ontrails/core/redaction`)

Strip sensitive data from logs and outputs.

```typescript
import {
  createRedactor,
  DEFAULT_PATTERNS,
  DEFAULT_SENSITIVE_KEYS,
} from '@ontrails/core/redaction';

const redactor = createRedactor({
  patterns: DEFAULT_PATTERNS,
  sensitiveKeys: DEFAULT_SENSITIVE_KEYS,
});
```

### Validation

- **`validateInput(schema, data)`** -- Validate data against a Zod schema, returning `Result`.
- **`formatZodIssues(issues)`** -- Format Zod issues into human-readable strings.
- **`zodToJsonSchema(schema)`** -- Convert a Zod schema to JSON Schema for MCP/HTTP surfaces.

### Branded Types

Nominal typing for IDs and domain-specific strings that should not be interchangeable.

```typescript
import { uuid, email, nonEmptyString, positiveInt } from '@ontrails/core';

const id = uuid('550e8400-e29b-41d4-a716-446655440000');
const addr = email('user@example.com');
```

### Collections and Guards

- **Collections** -- `chunk`, `dedupe`, `groupBy`, `sortBy`, `isNonEmptyArray`
- **Guards** -- `isDefined`, `isNonEmptyString`, `isPlainObject`, `hasProperty`, `assertNever`
- **Resilience** -- `retry`, `withTimeout`, `shouldRetry`, `getBackoffDelay`
- **Serialization** -- `serializeError`, `deserializeError`, `Result.fromJson`, `Result.toJson`
- **Path Security** -- `securePath`, `isPathSafe`, `resolveSafePath`
- **Workspace** -- `findWorkspaceRoot`, `isInsideWorkspace`, `getRelativePath`

### Layers

Cross-cutting concerns that wrap trail execution:

```typescript
const loggingLayer: Layer = {
  name: 'logging',
  wrap: (next, trail) => async (input, ctx) => {
    ctx.logger.info(`Executing ${trail.id}`);
    return next(input, ctx);
  },
};
```

## Subpath Exports

| Export | Contents |
| --- | --- |
| `@ontrails/core` | trail, hike, event, topo, Result, errors, types, validation, guards, collections, layers |
| `@ontrails/core/patterns` | Reusable Zod schema patterns |
| `@ontrails/core/redaction` | Redactor, default patterns and keys |

## Further Reading

- [Getting Started](../../docs/getting-started.md)
- [Architecture](../../docs/architecture.md)
- [Vocabulary](../../docs/vocabulary.md)
