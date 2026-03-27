# Stage 09 — apps/trails-demo

> The example app that proves the whole stack works. Define trails, blaze on CLI + MCP, test with one line.

---

## Overview

`apps/trails-demo` is a complete working application built with the Trails framework. It demonstrates every core concept: trails, a route, an event, examples, markers, detours, and blazing on both CLI and MCP surfaces. It serves as both a validation that the stack works end-to-end and as the "getting started" tutorial for new developers.

The domain: **entity management** -- a small CRUD + search system with enough depth to exercise composition, error handling, and progressive assertion.

---

## Prerequisites

- **All prior stages complete** (01-08). The demo app consumes the full stack.
- `@ontrails/core`, `@ontrails/cli`, `@ontrails/mcp`, `@ontrails/logging`, `@ontrails/testing`, `@ontrails/schema`.

---

## Implementation Guide

### Package Structure

```
apps/trails-demo/
  package.json
  tsconfig.json
  README.md                     # Getting-started tutorial
  bin/
    demo.ts                     # CLI entry point
  src/
    app.ts                      # trailhead() setup
    mcp.ts                      # MCP entry point
    trails/
      entity.ts                 # entity.show, entity.add, entity.delete, entity.list
      search.ts                 # search
      onboard.ts                # entity.onboard (route)
    events/
      entity-events.ts          # entity.updated (event)
    store.ts                    # In-memory entity store (no external deps)
  __tests__/
    examples.test.ts            # testAllExamples() -- the one-liner
    contracts.test.ts           # testContracts()
    detours.test.ts             # testDetours()
    entity.test.ts              # Custom scenario tests
    search.test.ts              # Custom scenario tests
    onboard.test.ts             # Route composition tests
```

**package.json:**

```json
{
  "name": "trails-demo",
  "bin": {
    "demo": "./bin/demo.ts"
  },
  "dependencies": {
    "@ontrails/core": "workspace:*",
    "@ontrails/cli": "workspace:*",
    "@ontrails/mcp": "workspace:*",
    "@ontrails/logging": "workspace:*"
  },
  "devDependencies": {
    "@ontrails/testing": "workspace:*",
    "@ontrails/schema": "workspace:*"
  }
}
```

### Domain: Entity Management

The demo uses a simple in-memory entity store. No database, no external dependencies. The focus is on demonstrating Trails patterns, not infrastructure.

```typescript
// src/store.ts
export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createStore(seed?: readonly Entity[]): EntityStore;

export interface EntityStore {
  get(name: string): Entity | undefined;
  add(entity: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Entity;
  delete(name: string): boolean;
  list(options?: { type?: string; limit?: number; offset?: number }): Entity[];
  search(query: string): Entity[];
}
```

The store is injected via `TrailContext` (using a service override or direct context property). For the demo, the store is created at app startup and passed through context.

### Trail Definitions

#### `entity.show` -- Show a single entity

```typescript
// src/trails/entity.ts
export const show = trail('entity.show', {
  description: 'Show an entity by name',
  input: z.object({
    name: z.string().describe('Entity name to look up'),
  }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    tags: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  readOnly: true,
  detours: {
    NotFoundError: ['search'],
  },
  examples: [
    {
      description: 'Show entity by name',
      input: { name: 'Alpha' },
      expected: {
        id: 'e1',
        name: 'Alpha',
        type: 'concept',
        tags: ['core'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    },
    {
      description: 'Entity not found',
      input: { name: 'nonexistent' },
      error: NotFoundError,
    },
  ],
  implementation: async (input, ctx) => {
    const entity = ctx.store.get(input.name);
    if (!entity) {
      return Result.err(new NotFoundError(`Entity "${input.name}" not found`));
    }
    return Result.ok(entity);
  },
});
```

**Markers demonstrated:** `readOnly: true`. **Detours demonstrated:** `NotFoundError` suggests the `search` trail.

#### `entity.add` -- Create a new entity

```typescript
export const add = trail('entity.add', {
  description: 'Create a new entity',
  input: z.object({
    name: z.string().describe('Entity name'),
    type: z.string().describe('Entity type (concept, tool, pattern)'),
    tags: z
      .array(z.string())
      .optional()
      .default([])
      .describe('Tags for categorization'),
  }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    tags: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  examples: [
    {
      description: 'Add a new entity',
      input: { name: 'Beta', type: 'tool', tags: ['automation'] },
    },
    {
      description: 'Duplicate entity returns conflict',
      input: { name: 'Alpha', type: 'concept' },
      error: AlreadyExistsError,
    },
  ],
  implementation: async (input, ctx) => {
    const existing = ctx.store.get(input.name);
    if (existing) {
      return Result.err(
        new AlreadyExistsError(`Entity "${input.name}" already exists`)
      );
    }
    const entity = ctx.store.add({
      name: input.name,
      type: input.type,
      tags: input.tags ?? [],
    });
    return Result.ok(entity);
  },
});
```

**Note:** The "Add a new entity" example uses schema-only matching (no `output` field) because the output contains generated fields (`id`, `createdAt`).

#### `entity.delete` -- Delete an entity

```typescript
export const remove = trail('entity.delete', {
  description: 'Delete an entity by name',
  input: z.object({
    name: z.string().describe('Entity name to delete'),
  }),
  output: z.object({
    deleted: z.boolean(),
    name: z.string(),
  }),
  destructive: true,
  examples: [
    {
      description: 'Delete an existing entity',
      input: { name: 'Alpha' },
      expected: { deleted: true, name: 'Alpha' },
    },
    {
      description: 'Delete non-existent entity returns not found',
      input: { name: 'nonexistent' },
      error: NotFoundError,
    },
  ],
  implementation: async (input, ctx) => {
    const deleted = ctx.store.delete(input.name);
    if (!deleted) {
      return Result.err(new NotFoundError(`Entity "${input.name}" not found`));
    }
    return Result.ok({ deleted: true, name: input.name });
  },
});
```

**Markers demonstrated:** `destructive: true` (auto-adds `--dry-run` on CLI).

#### `entity.list` -- List entities with optional filtering

```typescript
export const list = trail('entity.list', {
  description: 'List entities with optional type filter',
  input: z.object({
    type: z.string().optional().describe('Filter by entity type'),
    limit: z.number().optional().default(20).describe('Maximum results'),
    offset: z.number().optional().default(0).describe('Pagination offset'),
  }),
  output: z.object({
    entities: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        tags: z.array(z.string()),
      })
    ),
    total: z.number(),
  }),
  readOnly: true,
  examples: [
    {
      description: 'List all entities',
      input: {},
    },
    {
      description: 'List entities by type',
      input: { type: 'concept' },
    },
  ],
  implementation: async (input, ctx) => {
    const entities = ctx.store.list({
      type: input.type,
      limit: input.limit,
      offset: input.offset,
    });
    return Result.ok({
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        tags: e.tags,
      })),
      total: entities.length,
    });
  },
});
```

#### `search` -- Full-text search across entities

```typescript
// src/trails/search.ts
export const search = trail('search', {
  description: 'Search entities by keyword',
  input: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(10).describe('Maximum results'),
  }),
  output: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        tags: z.array(z.string()),
      })
    ),
    query: z.string(),
    total: z.number(),
  }),
  readOnly: true,
  examples: [
    {
      description: 'Search for entities',
      input: { query: 'Alpha' },
    },
    {
      description: 'Search with no results',
      input: { query: 'zzz_nonexistent_zzz' },
    },
  ],
  implementation: async (input, ctx) => {
    const results = ctx.store.search(input.query);
    const limited = results.slice(0, input.limit);
    return Result.ok({
      results: limited.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        tags: e.tags,
      })),
      query: input.query,
      total: results.length,
    });
  },
});
```

### Route: `entity.onboard`

A composite trail that follows `entity.add` and `search` to create an entity and verify it's searchable:

```typescript
// src/trails/onboard.ts
export const onboard = hike('entity.onboard', {
  description: 'Create an entity and verify it appears in search',
  follows: ['entity.add', 'search'],
  input: z.object({
    name: z.string().describe('Entity name'),
    type: z.string().describe('Entity type'),
    tags: z.array(z.string()).optional().default([]),
  }),
  output: z.object({
    entity: z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
    }),
    searchable: z.boolean(),
  }),
  examples: [
    {
      description: 'Onboard a new entity',
      input: { name: 'Gamma', type: 'pattern', tags: ['workflow'] },
    },
  ],
  implementation: async (input, ctx) => {
    const added = await ctx.follow('entity.add', {
      name: input.name,
      type: input.type,
      tags: input.tags,
    });
    if (added.isErr()) return added;

    const searched = await ctx.follow('search', { query: input.name });
    const searchable = searched.isOk() && searched.value.total > 0;

    return Result.ok({
      entity: {
        id: added.value.id,
        name: added.value.name,
        type: added.value.type,
      },
      searchable,
    });
  },
});
```

**Demonstrates:** `route()`, `follows` declaration, `ctx.follow()` calls, composition with error propagation.

### Event: `entity.updated`

```typescript
// src/events/entity-events.ts
export const updated = event('entity.updated', {
  description: 'Emitted when an entity is created, modified, or deleted',
  payload: z.object({
    entityId: z.string(),
    entityName: z.string(),
    action: z.enum(['created', 'updated', 'deleted']),
    timestamp: z.string(),
  }),
  from: ['entity.add', 'entity.delete'],
});
```

**Demonstrates:** `event()` with `from` linking events to the trails that produce them.

### App Setup

```typescript
// src/app.ts
import * as entity from './trails/entity.js';
import * as search from './trails/search.js';
import * as onboard from './trails/onboard.js';
import * as entityEvents from './events/entity-events.js';

export const app = topo('demo', entity, search, onboard, entityEvents);
```

### Blazed on CLI

```typescript
// bin/demo.ts
#!/usr/bin/env bun
import { blaze } from "@ontrails/cli/commander";
import { app } from "../src/app.js";

blaze(app);
```

**CLI commands generated:**

```
demo entity show --name Alpha
demo entity add --name Beta --type tool --tags automation
demo entity delete --name Alpha
demo entity list --type concept
demo search --query Alpha
demo entity onboard --name Gamma --type pattern
```

### Blazed on MCP

```typescript
// src/mcp.ts
import { blaze } from '@ontrails/mcp';
import { app } from './app.js';

blaze(app, { name: 'demo', version: '0.1.0' });
```

**MCP tools generated:**

```
demo_entity_show
demo_entity_add
demo_entity_delete
demo_entity_list
demo_search
demo_entity_onboard
```

### Tests

#### `examples.test.ts` -- The One-Liner

```typescript
import { testExamples, createTestContext } from '@ontrails/testing';
import { app } from '../src/app.js';
import { createStore } from '../src/store.js';

const seedData = [{ name: 'Alpha', type: 'concept', tags: ['core'] }];

const testApp = app.forTesting({
  store: createStore(seedData),
});

testAllExamples(testApp, createTestTrailContext());
```

This single file tests every trail, every example, with progressive assertion. Full-match examples assert exact output. Schema-only examples assert the result is ok and matches the output schema. Error examples assert the correct error type.

#### `contracts.test.ts`

```typescript
import { testContracts, createTestContext } from '@ontrails/testing';
import { app } from '../src/app.js';

const testApp = app.forTesting({
  store: createStore(seedData),
});

testContracts(testApp, createTestTrailContext());
```

Verifies every implementation's actual output matches its declared output schema.

#### `detours.test.ts`

```typescript
import { testDetours } from '@ontrails/testing';
import { app } from '../src/app.js';

testDetours(app);
```

Verifies all detour targets (`entity.show` -> `search`) exist in the topo.

#### `entity.test.ts` -- Custom Scenarios

```typescript
import { testScenarios, createTestContext } from '@ontrails/testing';
import { show, add, remove } from '../src/trails/entity.js';

const ctx = createTestTrailContext({
  store: createStore(seedData),
});

testScenarios(
  show,
  [
    {
      description: 'Case insensitivity check',
      input: { name: 'alpha' },
      error: NotFoundError,
    },
    { description: 'Empty name', input: { name: '' }, error: ValidationError },
  ],
  ctx
);

testScenarios(
  add,
  [
    {
      description: 'Add with empty tags',
      input: { name: 'Delta', type: 'tool' },
      expectOk: true,
    },
    {
      description: 'Missing required type',
      input: { name: 'Delta' },
      error: ValidationError,
    },
  ],
  ctx
);
```

#### `onboard.test.ts` -- Route Tests

```typescript
import { testScenarios, createTestContext } from '@ontrails/testing';
import { onboard } from '../src/trails/onboard.js';

testScenarios(
  onboard,
  [
    {
      description: 'Onboard creates and makes searchable',
      input: { name: 'Epsilon', type: 'concept' },
      expectOk: true,
    },
    {
      description: 'Onboard with duplicate name fails',
      input: { name: 'Alpha', type: 'concept' },
      error: AlreadyExistsError,
    },
  ],
  ctx
);
```

### README as Getting-Started Tutorial

The `README.md` walks through:

1. **What this app does** -- Entity CRUD + search, 5 trails, 1 route, 1 event.
2. **Running the CLI** -- `bun run bin/demo.ts entity show --name Alpha`.
3. **Running the MCP server** -- `bun run src/mcp.ts`.
4. **Understanding the code** -- Walk through `entity.show` trail definition, explaining `input`, `output`, `examples`, `detours`, `readOnly`.
5. **The route** -- Walk through `entity.onboard`, explaining `follows` and `ctx.follow()`.
6. **Testing** -- Show the `testAllExamples()` one-liner and what it validates.
7. **Adding a new trail** -- Step-by-step guide to adding `entity.update`.
8. **Running warden** -- `trails warden` to check governance.
9. **Generating the surface map** -- `trails survey generate`.

---

## Testing Requirements

The demo app's tests ARE the validation that the stack works:

- `testAllExamples` runs all examples across all trails -- proves example-driven testing works.
- `testContracts` verifies output schemas -- proves contract testing works.
- `testDetours` validates detour references -- proves structural validation works.
- `testTrail` with custom scenarios -- proves per-trail scenario testing works.
- CLI entry point runs without errors -- proves `blaze()` on CLI works.
- MCP entry point runs without errors -- proves `blaze()` on MCP works.
- Route `entity.onboard` correctly follows `entity.add` and `search` -- proves `ctx.follow()` composition works.
- Event `entity.updated` has valid `from` references -- proves event wiring works.

---

## Definition of Done

- [ ] 5 trails defined: `entity.show`, `entity.add`, `entity.delete`, `entity.list`, `search`.
- [ ] 1 route defined: `entity.onboard` with `follows: ["entity.add", "search"]`.
- [ ] 1 event defined: `entity.updated` with `from`.
- [ ] Every trail has at least 1 example. Most have 2+ (success + error).
- [ ] Markers used: `readOnly` on show/list/search, `destructive` on delete.
- [ ] Detours used: `entity.show` suggests `search` on `NotFoundError`.
- [ ] Blazed on CLI -- `demo entity show --name Alpha` works.
- [ ] Blazed on MCP -- MCP tool calls work.
- [ ] `testAllExamples()` one-liner validates the entire app.
- [ ] `testContracts()` verifies output schemas.
- [ ] `testDetours()` verifies detour targets.
- [ ] Custom scenario tests cover edge cases.
- [ ] `README.md` serves as a getting-started tutorial.
- [ ] All tests pass.
- [ ] The demo proves the whole stack works end-to-end.
