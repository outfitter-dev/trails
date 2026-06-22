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

const graph = topo('myapp', { greet });
```

Trails compose other trails through `composes` and `ctx.compose()`:

```typescript
const onboard = trail('entity.onboard', {
  composes: ['entity.add', 'entity.relate'],
  input: z.object({ name: z.string(), type: z.string() }),
  blaze: async (input, ctx) => {
    const added = await ctx.compose('entity.add', input);
    if (added.isErr()) return added;
    return Result.ok({ entity: added.value });
  },
});
```

## API

### Trail primitives

| Export | What it does |
| --- | --- |
| `trail(id, spec)` | Define a unit of work with typed input and `Result` output; use `composes` for composition |
| `signal(id, spec)` | Define a server-originated notification with a typed data schema |
| `resource(id, spec)` | Define an infrastructure dependency with `create`, `dispose`, and optional `mock` |
| `drainResources(resources, ctx, configValues?)` | Evict and dispose cached resource singletons for surface/test shutdown |
| `blobRefSchema` / `createBlobRef(...)` | Declare and create binary output references with a shared descriptor contract |
| `topo(name, ...modules, options?)` | Collect trail modules into a queryable topology with optional `observe:` sinks |
| `deriveTrail(contour, operation, spec)` | Derive CRUD-shaped trail contracts from a contour on the `@ontrails/core/trails` subpath |
| `validateTopo(topo)` | Structural validation: compose targets exist, no cycles, examples parse, output schemas present |

### Execution

| Export | What it does |
| --- | --- |
| `executeTrail(trail, rawInput, options?)` | Centralized execution pipeline: validates input, builds context, composes layers, runs the blazed trail. Never throws -- exceptions become `Result.err(InternalError)`. |
| `run(topo, id, input, options?)` | Headless trail execution by ID. Looks up the trail in the topo, then delegates to `executeTrail`. Returns `Result.err(NotFoundError)` if the ID is not registered. |

```typescript
// executeTrail — surfaces use this directly
const surfaceResult = await executeTrail(greet, { name: 'Alice' });

// run — headless execution by trail ID
const runResult = await run(graph, 'greet', { name: 'Alice' });
if (runResult.isOk()) console.log(runResult.value);
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
| `ExecuteTrailOptions` | Options for `executeTrail`: `ctx`, `abortSignal`, `layers`, `createContext` |
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

The current taxonomy is generated from the `errorClasses` owner registry and category code maps in `@ontrails/core`.

<!-- error-taxonomy:start -->
<!-- GENERATED: run `bun run error-taxonomy:sync`; check with `bun run error-taxonomy:check`. Variant: category. -->

| Category | CLI Exit | HTTP | JSON-RPC | Retryable | Fixed Classes |
| --- | --- | --- | --- | --- | --- |
| `validation` | 1 | 400 | -32602 | No | `ValidationError`, `AmbiguousError` |
| `not_found` | 2 | 404 | -32601 | No | `NotFoundError`, `VersionNotSupportedError` |
| `conflict` | 3 | 409 | -32603 | No | `AlreadyExistsError`, `ConflictError` |
| `permission` | 4 | 403 | -32600 | No | `PermissionError`, `PermitError` |
| `timeout` | 5 | 504 | -32603 | Yes | `TimeoutError` |
| `rate_limit` | 6 | 429 | -32603 | Yes | `RateLimitError` |
| `network` | 7 | 502 | -32603 | Yes | `NetworkError` |
| `shift` | 10 | 503 | -32603 | Yes | `WorkspaceShiftError` |
| `internal` | 8 | 500 | -32603 | No | `AssertionError`, `InternalError`, `DerivationError`, `RecoverableCompletionError` |
| `auth` | 9 | 401 | -32600 | No | `AuthError` |
| `cancelled` | 130 | 499 | -32603 | No | `CancelledError` |

Dynamic classes:

- `RetryExhaustedError` inherits category and surface codes from its wrapped `TrailsError`; retryable is always No.
<!-- error-taxonomy:end -->

Public surface projections redact sensitive substrings before exposing a non-internal `TrailsError` message. Internal-category `TrailsError` instances and unknown native errors project with the generic message `Internal server error`; diagnostics and serialized payloads keep their useful structure while redacting messages, context, and stack strings.

The developer returns `Result.err(new NotFoundError(...))`. The framework maps it to the right code on every surface.

### Other exports

- **Schema derivation** -- `deriveFields(schema)` extracts faithfully
  representable field metadata from Zod for prompts and forms
- **Validation** -- `validateInput`, `formatZodIssues`, `zodToJsonSchema`
- **Resilience** -- `retry`, `withTimeout`, `shouldRetry`, `deriveBackoffDelay`
- **Serialization** -- `serializeError`, `deserializeError`
- **Branded types** -- `uuid`, `email`, `nonEmptyString`, `positiveInt`
- **Execution layers** -- low-level pipeline wrappers via `composeLayers`
- **Guards and collections** -- `isDefined`, `chunk`, `dedupe`, `groupBy`, `sortBy`
- **Patterns** (`@ontrails/core/patterns`) -- reusable Zod schemas for pagination, bulk ops, timestamps, sorting
- **Trail factories** (`@ontrails/core/trails`) -- derive CRUD-shaped trail contracts from contours without re-authoring IDs, schemas, examples, or intents
- **Redaction** (`@ontrails/core/redaction`) -- strip sensitive data before logging

### Public helper boundaries

The root package also exposes a few low-level contracts that other framework packages build on:

- **Intrinsic tracing** -- `TraceRecord`, `TraceSink`, `TraceContext`, and the sink registry helpers are the core-owned execution record shape shared by `@ontrails/observe`, `@ontrails/tracing`, and adapters.
- **Trails DB** -- `deriveTrailsDbPath`, `deriveTrailsStateDir`, `deriveTrailsStateHome`, `deriveTrailsProjectKey`, `deriveTrailsDir`, `ensureSubsystemSchema`, `openReadTrailsDb`, and `openWriteTrailsDb` are the generic database primitive used by framework subsystems.
- **Surface projection helpers** -- safe error projection, layer field projection, compose-batch validation, late-bound signal references, and Zod default-wrapper stripping are stable root exports for first-party surfaces, store helpers, and tests.

See the [API Reference](../../docs/api-reference.md) for the full list.

## Migration: topo-store moved to `@ontrails/topographer`

Per [ADR-0042](../../docs/adr/0042-core-topographer-boundary-doctrine.md), the topo-store public API previously exported from `@ontrails/core` now lives in `@ontrails/topographer`. Generic `trails-db` helpers (`openReadTrailsDb`, `openWriteTrailsDb`, `ensureSubsystemSchema`, `deriveTrailsDbPath`, `deriveTrailsStateDir`, `deriveTrailsStateHome`, `deriveTrailsProjectKey`, `deriveTrailsDir`) stay in core because tracing and other subsystems share them.

Update consumer imports:

```diff
- import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot, createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/core';
+ import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot } from '@ontrails/topographer';
+ import { createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/topographer/backend-support';
```

Types `ReadOnlyTopoStore`, `MockTopoStoreSeed`, `TopoSnapshot`, `TopoStoreRef`, `TopoStoreExportRecord`, `TopoStoreResourceRecord`, `TopoStoreTrailRecord`, `TopoStoreTrailDetailRecord`, `CreateTopoSnapshotInput`, and `ListTopoSnapshotsOptions` move to `@ontrails/topographer`. `StoredTopoExport` moves to `@ontrails/topographer/backend-support`.

## Installation

```bash
bun add @ontrails/core@beta zod
```
