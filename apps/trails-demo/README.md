# trails-demo

A complete working application built with the Trails framework. It demonstrates every core concept: trails, composition via `follow`, an event, examples, metadata, detours, idempotent upsert, and blazing on CLI, MCP, and HTTP surfaces.

## What this app does

Entity management -- a small CRUD + search system with enough depth to exercise composition, error handling, and progressive assertion.

| Trail | Description | Intent / Metadata |
| --- | --- | --- |
| `entity.show` | Show an entity by name | `intent: 'read'`, detours to `search` |
| `entity.add` | Create a new entity | -- |
| `entity.delete` | Delete an entity by name | `intent: 'destroy'` |
| `entity.list` | List entities with optional type filter | `intent: 'read'` |
| `search` | Full-text search across entities | `intent: 'read'` |
| `entity.onboard` | Composition: create + verify searchable | `follow: ['entity.add', 'search']` |
| `demo.upsert` | Idempotent key-value store example | `idempotent: true` |

Plus one event: `entity.updated` (triggered by `entity.add` and `entity.delete`).

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

# Onboard (follow: add + verify searchable)
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
export const show = trail('entity.show', {
  description: 'Show an entity by name',
  input: z.object({ name: z.string() }),
  output: entitySchema,
  intent: 'read',
  detours: { NotFoundError: ['search'] },
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
  run: async (input, ctx) => {
    /* ... */
  },
});
```

Key concepts:

- **`input` / `output`**: Zod schemas define the contract. Validated at the boundary, trusted internally.
- **`intent`**: Safety property. On CLI, `'read'` prevents destructive flags. On MCP, `'read'` sets `readOnlyHint`, `'destroy'` sets `destructiveHint`.
- **`detours`**: When `entity.show` returns `NotFoundError`, the surface can suggest `search` as a next step.
- **`examples`**: Agent-facing documentation that doubles as tests. Full-match examples assert exact output. Error examples assert the error class name. Schema-only examples (no `expected` or `error`) just validate the output matches the schema.

### Composition: `entity.onboard`

```typescript
export const onboard = trail('entity.onboard', {
  follow: ['entity.add', 'search'],
  run: async (input, ctx) => {
    const added = await ctx.follow('entity.add', {
      /* ... */
    });
    if (added.isErr()) return added;
    const searched = await ctx.follow('search', { query: input.name });
    // ...
  },
});
```

- **`follow`** declares which trails this trail composes.
- **`ctx.follow()`** invokes another trail by ID, maintaining the execution context.

## Testing

### The one-liner

```typescript
import { testAll } from '@ontrails/testing';
import { app } from '../src/app.js';
import { createStore } from '../src/store.js';

testAll(app, () => ({
  store: createStore([
    { name: 'Alpha', tags: ['core'], type: 'concept' },
    { name: 'Deletable', tags: ['temp'], type: 'tool' },
  ]),
}));
```

`testAll` runs the full governance suite in one call:

1. **`validateTopo`** -- structural validation (follow targets exist, declarations are consistent).
2. **`testExamples`** -- progressive assertion over every trail example.
3. **`testContracts`** -- output schema verification for every success example.
4. **`testDetours`** -- detour targets reference real trails in the topo.

Pass a factory function (not a plain object) when the context contains mutable state like an in-memory store, so each test gets a fresh copy.

### Progressive assertion

- **Full-match examples** (`expected` field): assert exact output equality.
- **Error examples** (`error` field): assert the result is an error of the named class.
- **Schema-only examples** (neither field): assert the result is ok and matches the output schema.

### Custom scenarios

```typescript
import { testTrail } from '@ontrails/testing';
testTrail(
  show,
  [
    {
      description: 'Case sensitivity',
      input: { name: 'alpha' },
      expectErr: NotFoundError,
    },
  ],
  { store }
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
     run: async (input, ctx) => {
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

Checks governance rules: every trail has examples, destructive trails declare `intent: 'destroy'`, follow targets reference existing trails, etc.

## Inspecting the app

```bash
trails survey
```

Produces a machine-readable map of all trails and events with their schemas, metadata, and relationships.
