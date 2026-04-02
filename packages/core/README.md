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
  blaze: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

const app = topo('myapp', { greet });
```

Trails compose other trails through `crosses` and `ctx.cross()`:

```typescript
const onboard = trail('entity.onboard', {
  crosses: ['entity.add', 'entity.relate'],
  input: z.object({ name: z.string(), type: z.string() }),
  blaze: async (input, ctx) => {
    const added = await ctx.cross('entity.add', input);
    if (added.isErr()) return added;
    return Result.ok({ entity: added.value });
  },
});
```

## API

### Trail primitives

| Export | What it does |
| --- | --- |
| `trail(id, spec)` | Define a unit of work with typed input and `Result` output; use `crosses` for composition |
| `signal(id, spec)` | Define a server-originated notification with a typed data schema |
| `provision(id, spec)` | Define an infrastructure dependency with `create`, `dispose`, and optional `mock` |
| `topo(name, ...modules)` | Collect trail modules into a queryable topology |
| `validateTopo(topo)` | Structural validation: cross targets exist, no cycles, examples parse, output schemas present |

### Execution

| Export | What it does |
| --- | --- |
| `executeTrail(trail, rawInput, options?)` | Centralized execution pipeline: validates input, builds context, composes gates, runs the implementation. Never throws -- exceptions become `Result.err(InternalError)`. |
| `run(topo, id, input, options?)` | Headless trail execution by ID. Looks up the trail in the topo, then delegates to `executeTrail`. Returns `Result.err(NotFoundError)` if the ID is not registered. |

```typescript
// executeTrail — trailheads use this directly
const result = await executeTrail(greet, { name: 'Alice' });

// run — no-trailhead execution by trail ID
const result = await run(app, 'greet', { name: 'Alice' });
if (result.isOk()) console.log(result.value);
```

### Topo accessors

Beyond the `trail(id, spec)` builder, `Topo` exposes these accessors:

| Accessor | What it returns |
| --- | --- |
| `topo.ids()` | `string[]` of all registered trail IDs |
| `topo.count` | Number of registered trails |
| `topo.get(id)` | The `Trail` with that ID, or `undefined` |
| `topo.has(id)` | Whether a trail ID is registered |
| `topo.list()` | All registered trails as an array |

### Type utilities

| Export | What it does |
| --- | --- |
| `TrailInput<T>` | Extract the input type from a `Trail` |
| `TrailOutput<T>` | Extract the output type from a `Trail` |
| `TrailResult<T>` | `Result<TrailOutput<T>, Error>` -- the Result type for a trail's output |
| `inputOf(trail)` | Get the input Zod schema from a trail instance |
| `outputOf(trail)` | Get the output Zod schema (or `undefined`) from a trail instance |

### Execution option types

| Type | What it describes |
| --- | --- |
| `ExecuteTrailOptions` | Options for `executeTrail`: `ctx`, `abortSignal`, `gates`, `createContext` |
| `RunOptions` | Same shape as `ExecuteTrailOptions`; forwarded by `run` |

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

13 error classes across 10 categories. Each maps deterministically to exit codes, HTTP status, and JSON-RPC codes on every trailhead.

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

The developer returns `Result.err(new NotFoundError(...))`. The framework maps it to the right code on every trailhead.

### Other exports

- **Schema derivation** -- `deriveFields(schema)` extracts field metadata from Zod for prompts and forms
- **Validation** -- `validateInput`, `formatZodIssues`, `zodToJsonSchema`
- **Resilience** -- `retry`, `withTimeout`, `shouldRetry`, `getBackoffDelay`
- **Serialization** -- `serializeError`, `deserializeError`
- **Branded types** -- `uuid`, `email`, `nonEmptyString`, `positiveInt`
- **Gates** -- cross-cutting gates via `composeGates`
- **Guards and collections** -- `isDefined`, `chunk`, `dedupe`, `groupBy`, `sortBy`
- **Patterns** (`@ontrails/core/patterns`) -- reusable Zod schemas for pagination, bulk ops, timestamps, sorting
- **Redaction** (`@ontrails/core/redaction`) -- strip sensitive data before logging

See the [API Reference](../../docs/api-reference.md) for the full list.

## Installation

```bash
bun add @ontrails/core zod
```
