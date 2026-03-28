# @ontrails/core

The foundation. Define trails, compose them into topos, return typed Results, and let the framework derive everything else.

## Usage

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

const app = topo('myapp', { greet });
```

Trails compose other trails through `follow` and `ctx.follow()`:

```typescript
const onboard = trail('entity.onboard', {
  follow: ['entity.add', 'entity.relate'],
  input: z.object({ name: z.string(), type: z.string() }),
  run: async (input, ctx) => {
    const added = await ctx.follow('entity.add', input);
    if (added.isErr()) return added;
    return Result.ok({ entity: added.value });
  },
});
```

## API

### Trail primitives

| Export | What it does |
| --- | --- |
| `trail(id, spec)` | Define a unit of work with typed input and `Result` output; use `follow` for composition |
| `event(id, spec)` | Define a server-originated push with a typed data schema |
| `topo(name, ...modules)` | Collect trail modules into a queryable topology |
| `validateTopo(topo)` | Structural validation: follow targets exist, no cycles, examples parse, output schemas present |

### Result

```typescript
Result.ok(value);            // Success
Result.err(error);           // Failure
Result.combine(results);     // Result<T>[] → Result<T[]>
Result.fromJson(json);       // Parse JSON string into Result
Result.toJson(value);        // Serialize to JSON string as Result
Result.fromFetch(response);  // Convert fetch Response to Result

result.isOk();               // Type guard
result.isErr();              // Type guard
result.map(fn);              // Transform success
result.flatMap(fn);          // Chain Result-returning functions
result.match({ ok, err });   // Pattern match
result.unwrapOr(fallback);   // Value or fallback
```

### Error taxonomy

13 error classes across 10 categories. Each maps deterministically to exit codes, HTTP status, and JSON-RPC codes on every surface.

| Category | Classes | HTTP | Retryable |
| --- | --- | --- | --- |
| `validation` | `ValidationError`, `AmbiguousError`, `AssertionError` | 400 | No |
| `not_found` | `NotFoundError` | 404 | No |
| `conflict` | `AlreadyExistsError`, `ConflictError` | 409 | No |
| `permission` | `PermissionError` | 403 | No |
| `timeout` | `TimeoutError` | 504 | Yes |
| `rate_limit` | `RateLimitError` | 429 | Yes |
| `network` | `NetworkError` | 502 | Yes |
| `internal` | `InternalError` | 500 | No |
| `auth` | `AuthError` | 401 | No |
| `cancelled` | `CancelledError` | 499 | No |

The developer returns `Result.err(new NotFoundError(...))`. The framework maps it to the right code on every surface.

### Other exports

- **Schema derivation** -- `deriveFields(schema)` extracts field metadata from Zod for prompts and forms
- **Validation** -- `validateInput`, `formatZodIssues`, `zodToJsonSchema`
- **Resilience** -- `retry`, `withTimeout`, `shouldRetry`, `getBackoffDelay`
- **Serialization** -- `serializeError`, `deserializeError`
- **Branded types** -- `uuid`, `email`, `nonEmptyString`, `positiveInt`
- **Layers** -- cross-cutting middleware via `composeLayers`
- **Guards and collections** -- `isDefined`, `chunk`, `dedupe`, `groupBy`, `sortBy`
- **Patterns** (`@ontrails/core/patterns`) -- reusable Zod schemas for pagination, bulk ops, timestamps, sorting
- **Redaction** (`@ontrails/core/redaction`) -- strip sensitive data before logging

See the [API Reference](../../docs/api-reference.md) for the full list.

## Installation

```bash
bun add @ontrails/core zod
```
