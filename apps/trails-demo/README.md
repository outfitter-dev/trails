# trails-demo

A complete working application built with the Trails framework. It demonstrates every core concept: trails, composition via `crosses`, a first-class resource, a schema-derived store, a signal, examples, meta, detours, idempotent upsert, and surface entrypoints on CLI, MCP, and HTTP.

## What this app does

Entity management -- a small CRUD + search system with enough depth to exercise composition, error handling, and progressive assertion.

| Trail | Description | Intent / Metadata |
| --- | --- | --- |
| `entity.show` | Show an entity by name | `intent: 'read'`, detours to `search` |
| `entity.add` | Create a new entity | -- |
| `entity.delete` | Delete an entity by name | `intent: 'destroy'` |
| `entity.list` | List entities with optional type filter | `intent: 'read'` |
| `search` | Full-text search across entities | `intent: 'read'` |
| `entity.onboard` | Composition: create + verify searchable | `crosses: ['entity.add', 'search']` |
| `demo.upsert` | Idempotent key-value store example | `idempotent: true` |

Plus one signal: `entity.updated` (fired by `entity.add` and `entity.delete`).

Plus one resource: `demo.entity-store` (a Drizzle-backed in-memory entity store derived from a root `store(...)` definition).

## Running the CLI

```bash
# Show an entity
bun run bin/demo.ts entity show --name Alpha

# Add an entity
bun run bin/demo.ts entity add --name Delta --type tool --tags automation

# Delete an entity
bun run bin/demo.ts entity delete --name Alpha

# List all entities
bun run bin/demo.ts entity list

# List by type
bun run bin/demo.ts entity list --type concept

# Search
bun run bin/demo.ts search --query Alpha

# Onboard (crosses: add + verify searchable)
bun run bin/demo.ts entity onboard --name Epsilon --type pattern
```

## Running the HTTP server

```bash
bun run http
```

This starts a Hono-based HTTP server on port 3000. Routes are derived from trail IDs, verbs from intent:

```bash
# Read trail (GET)
curl http://localhost:3000/entity/show?name=Alpha

# Write trail (POST)
curl -X POST http://localhost:3000/entity/add -H 'Content-Type: application/json' -d '{"name":"Gamma","type":"pattern"}'

# Destructive trail (DELETE)
curl -X DELETE http://localhost:3000/entity/delete -H 'Content-Type: application/json' -d '{"name":"Deletable"}'

# Idempotent upsert (POST — repeating produces the same result)
curl -X POST http://localhost:3000/demo/upsert -H 'Content-Type: application/json' -d '{"key":"theme","value":"dark"}'
```

## Running the MCP server

```bash
bun run src/mcp.ts
```

This exposes MCP tools: `demo_entity_show`, `demo_entity_add`, `demo_entity_delete`, `demo_entity_list`, `demo_search`, `demo_entity_onboard`, `demo_demo_upsert`.

## Understanding the code

### Trail definition: `entity.show`

```typescript
import { entityStoreResource } from '../src/resources/entity-store.js';

export const show = trail('entity.show', {
  description: 'Show an entity by name',
  input: z.object({ name: z.string() }),
  output: entitySchema,
  intent: 'read',
  detours: [
    {
      on: NotFoundError,
      recover: async ({ input }, ctx) => ctx.cross('search', input),
    },
  ],
  resources: [entityStoreResource],
  examples: [
    {
      name: 'Show entity by name',
      input: { name: 'Alpha' },
      expected: {
        /* ... */
      },
    },
    {
      name: 'Entity not found',
      input: { name: 'nonexistent' },
      error: 'NotFoundError',
    },
  ],
  blaze: async (input, ctx) => {
    const store = entityStoreResource.from(ctx);
    /* ... */
  },
});
```

Key concepts:

- **`input` / `output`**: Zod schemas define the contract. Validated at the boundary, trusted internally.
- **`intent`**: Safety property. On CLI, `'read'` prevents destructive flags. On MCP, `'read'` sets `readOnlyHint`, `'destroy'` sets `destructiveHint`.
- **`detours`**: When `entity.show` returns `NotFoundError`, the detour can recover by crossing into `search`.
- **`examples`**: Agent-facing documentation that doubles as tests. Full-match examples assert exact output. Error examples assert the error class name. Schema-only examples (no `expected` or `error`) just validate the output matches the schema.

### Composition: `entity.onboard`

```typescript
export const onboard = trail('entity.onboard', {
  crosses: ['entity.add', 'search'],
  blaze: async (input, ctx) => {
    const added = await ctx.cross('entity.add', {
      /* ... */
    });
    if (added.isErr()) return added;
    const searched = await ctx.cross('search', { query: input.name });
    // ...
  },
});
```

- **`crosses`** declares which trails this trail composes.
- **`ctx.cross()`** invokes another trail by ID, maintaining the execution context.

## Testing

### The one-liner

```typescript
import { testAll } from '@ontrails/testing';
import { graph } from '../src/app.js';
import { createMockEntityStore, entityStoreResource } from '../src/resources/entity-store.js';

testAll(graph, () => ({
  resources: {
    [entityStoreResource.id]: createMockEntityStore(),
  },
}));
```

`testAll` runs the full governance suite in one call:

1. **`validateTopo`** -- structural validation (cross targets exist, declarations are consistent).
2. **`testExamples`** -- progressive assertion over every trail example.
3. **`testContracts`** -- output schema verification for every success example.
4. **`testDetours`** -- detours expose real `on` / `recover` contracts and non-shadowed ordering.

Pass a factory function (not a plain object) when your explicit resource overrides contain mutable state like an in-memory SQLite store, so each test gets a fresh copy.

### Progressive assertion

- **Full-match examples** (`expected` field): assert exact output equality.
- **Error examples** (`error` field): assert the result is an error of the named class.
- **Schema-only examples** (neither field): assert the result is ok and matches the output schema.

### Custom scenarios

```typescript
import { createStore } from '../src/store.js';
import { testTrail } from '@ontrails/testing';
import { entityStoreResource } from '../src/resources/entity-store.js';

testTrail(
  show,
  [
    {
      description: 'Case sensitivity',
      input: { name: 'alpha' },
      expectErr: NotFoundError,
    },
  ],
  {
    extensions: {
      [entityStoreResource.id]: createStore([
        { name: 'Alpha', tags: ['core'], type: 'concept' },
      ]),
    },
  }
);
```

## Adding a new trail

To add `entity.update`:

1. Define the trail in `src/trails/entity.ts`:

   ```typescript
   export const update = trail('entity.update', {
     description: 'Update an existing entity',
     input: z.object({
       name: z.string(),
       tags: z.array(z.string()).optional(),
     }),
     output: entitySchema,
     examples: [
       { name: 'Update tags', input: { name: 'Alpha', tags: ['updated'] } },
     ],
     blaze: async (input, ctx) => {
       /* ... */
     },
   });
   ```

2. The trail is automatically registered via the `entity` module import in `app.ts`.

3. Run tests: `bun test`

## Running warden

```bash
trails warden
```

Checks governance rules: every trail has examples, destructive trails declare `intent: 'destroy'`, cross targets reference existing trails, etc.

## Inspecting the app

```bash
# Inspect one trail or resource
trails survey --module ./src/app.ts entity.show
trails survey trail --module ./src/app.ts entity.show

# See saved topo history and pins
trails topo history --root-dir .

# Compile the committed lock artifacts
trails topo compile --module ./src/app.ts

# Get the broader machine-readable report
trails survey --module ./src/app.ts
trails survey brief --module ./src/app.ts
trails survey diff --module ./src/app.ts
```

Use `trails topo *` for the day-to-day operational flow: inspect the current topo, pin meaningful points, and compile or verify the committed lock artifacts. `survey` remains the broader introspection surface for list, detail, and diff output.

## Signals

The demo exercises the lexicon's reactive activation primitive end-to-end. A producer trail declares the signal it fires, calls `ctx.fire()` from its blaze, and any trail that lists the signal in `on:` runs automatically.

```typescript
// src/signals/entity-signals.ts
export const updated = signal('entity.updated', {
  from: ['entity.add', 'entity.delete'],
  payload: z.object({
    action: z.enum(['created', 'updated', 'deleted']),
    entityId: z.string(),
    entityName: z.string(),
    timestamp: z.string(),
  }),
});

// src/trails/entity.ts -- producer
export const add = trail('entity.add', {
  fires: [updated],
  blaze: async (input, ctx) => {
    const entity = await store.entities.insert(input);
    await ctx.fire?.(updated, {
      action: 'created',
      entityId: entity.id,
      entityName: entity.name,
      timestamp: entity.createdAt,
    });
    return Result.ok(entity);
  },
  // ...
});

// src/trails/notify.ts -- consumer
export const notifyEntityUpdated = trail('entity.notify-updated', {
  on: ['entity.updated'],
  blaze: (input, ctx) => {
    // runs automatically whenever entity.updated fires
    return Result.ok({ notified: true });
  },
  // ...
});
```

The warden enforces that signal declarations and consumers stay aligned, and that every `on:` reference resolves to a signal definition the topo actually knows about. See `__tests__/signals.test.ts` for the end-to-end proof.
