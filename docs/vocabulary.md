# Vocabulary

All Trails terms and their definitions. Brand the framework primitives, use plain language for everything else. For naming conventions and terminology decisions, see [ADR-0001](docs/adr/0001-naming-conventions.md).

## Naming Principle

Trails-branded terms are reserved for concepts unique to the framework. Infrastructure concepts that exist in every framework keep their standard names. The test: if a developer already knows what the word means from other frameworks, do not rename it.

## Locked Terms (shipped in v1)

These are final. They appear in the public API, documentation, and code.

### `trail`

The atomic unit of work. A defined path from typed input to `Result` output. `trail(id, spec)` defines a trail.

```typescript
const show = trail('entity.show', {
  input: z.object({ name: z.string() }),
  intent: 'read',
  run: async (input) => Result.ok({ name: input.name }),
});
```

### `event`

A server-originated push. Carries a Zod schema for the data shape. No implementation -- things happen and this is the announcement.

```typescript
const updated = event('entity.updated', {
  payload: z.object({ id: z.string(), name: z.string() }),
});
```

### `topo`

Collect trail modules into an app. Scans module exports for `Trail` shapes and builds the internal topo.

```typescript
const app = topo('myapp', entityModule, searchModule);
```

### `blaze`

Open an app's trails on a surface. The one-liner that wires everything up. Exported from each surface adapter.

```typescript
import { blaze } from '@ontrails/cli/commander';
blaze(app);

import { blaze as blazeMcp } from '@ontrails/mcp';
await blazeMcp(app);
```

"Blaze" specifically means "open trails on a surface." Do not use it as a general verb for "start" or "run."

### `follow`

Declare which trails a trail will compose, and the runtime verb for invoking them. The same word names both the declaration (`follow: [...]` on the trail spec) and the runtime call (`ctx.follow()`).

**As a declaration:**

```typescript
const onboard = trail('entity.onboard', {
  follow: ['entity.add', 'entity.relate', 'search'],
  input: z.object({ name: z.string(), type: z.string() }),
  run: async (input, ctx) => {
    const added = await ctx.follow('entity.add', input);
    if (added.isErr()) return added;
    return Result.ok({ entity: added.value });
  },
});
```

**As a runtime call:**

```typescript
const result = await ctx.follow('entity.add', {
  name: 'Alpha',
  type: 'concept',
});
```

The `follow` declaration is verified by the warden linter against actual `ctx.follow()` usage.

### `topo` (the data structure)

The internal collection of all trails -- the topography. The data structure that surfaces read, schema tools inspect, and `ctx.follow()` dispatches through. The `topo()` function returns a `Topo` object with `.trails`, `.events`, and `.services` maps, plus `.get()`, `.has()`, `.list()`, `.getService()`, `.hasService()`, and `.listServices()` accessors.

```typescript
const app = topo('myapp', entityModule);
app.trails; // ReadonlyMap of trail ID -> Trail
app.list(); // All trails
app.services; // ReadonlyMap of service ID -> Service
```

Most developers never interact with the topo directly. Use "the app" or "the trail collection" in introductory material.

### `implementation`

The pure function inside a trail. Input in, `Result` out. Knows nothing about surfaces. Always the full word -- never "impl."

```typescript
run: async (input, ctx) => Result.ok(value);
```

### `survey`

Full schema introspection of the trail system. Emits the topo as structured data. Available as `trails survey` in the CLI.

### `guide`

Runtime guidance layer -- how to use these trails. Available as `trails guide` in the CLI.

### `warden`

Governance and contract enforcement tooling. Lint rules, drift detection, CI gating. Available as `trails warden` in the CLI and as `@ontrails/warden`.

### `metadata`

Arbitrary metadata for tooling and filtering. Declared as `metadata` on the trail spec.

### `detours`

Error recovery and fallback paths when a trail fails. Declared as `detours` on the trail spec.

### `service`

An infrastructure dependency definition with lifecycle management and built-in testing support. Services wrap databases, caches, APIs, or any external resource a trail needs.

```typescript
const db = service('db', {
  create: () => Result.ok(createPool(process.env.DATABASE_URL)),
  mock: () => createMockPool(),
  dispose: (pool) => pool.end(),
});
```

Trails declare their service dependencies with `services: [...]` on the trail spec:

```typescript
const list = trail('entity.list', {
  services: [db],
  input: z.object({}),
  output: EntityListSchema,
  run: async (input, ctx) => {
    const pool = db.from(ctx);
    // ...
  },
});
```

Access services through `db.from(ctx)` for typed access or `ctx.service()` for dynamic lookup. The `mock` factory enables `testAll(app)` to run without real infrastructure.

### `permit`

The resolved identity and scopes from a successful authentication. Attached to `TrailContext` by the auth layer. Trails declare their permit requirements with the `permit` field on the trail spec.

```typescript
import { getPermit } from '@ontrails/permits';

const admin = trail('admin.dashboard', {
  permit: { scopes: ['admin:read'] },
  input: z.object({}),
  run: async (_input, ctx) => {
    const permit = getPermit(ctx);
    return Result.ok({ user: permit?.id });
  },
});
```

### `loadout`

A named config profile for a deployment environment. Loadouts are declared in `defineConfig()` and selected via `TRAILS_ENV` or explicit option.

```typescript
import { defineConfig } from '@ontrails/config';

const config = defineConfig({
  schema: z.object({
    port: z.number().default(3000),
    debug: z.boolean().default(false),
  }),
  loadouts: {
    production: { debug: false },
    test: { debug: true, port: 0 },
  },
});
```

### `crumbs`

Telemetry recording and trace context propagation. The crumbs layer captures execution duration, errors, and trace context for every trail invocation.

```typescript
import { createCrumbsLayer, createMemorySink } from '@ontrails/crumbs';

const sink = createMemorySink();
const layer = createCrumbsLayer(sink);
```

## Reserved Terms (designed, not yet shipped)

These are reserved for planned features. The naming is directional and may evolve.

| Term | Concept |
| --- | --- |
| `traverse` | Graph traversal, execution planning |
| `mount` | One-directional cross-app connection (consume another app's trails) |
| `junction` | Bidirectional peer connection between two Trails apps (future) |
| `pack` | Distributable capability bundle (trails + services + events + metadata) |
| `depot` | Pack registry and marketplace |

## Standard Terms (not branded)

These use plain language because the concepts are universal.

| Term | Concept | Why not branded |
| --- | --- | --- |
| `config` | Configuration | Every framework has config |
| `services` | Service declarations on a trail spec | The array syntax is standard; `service()` itself is branded |
| `health` | Health checks | Standard ops terminology |
| `Result` | Success/failure return | Standard in Rust, Haskell, Swift |
| `Layer` | Cross-cutting surface wrapper | Standard middleware concept |
| `Surface` | Transport type | Already clear and distinctive |
| `Implementation` | The pure function | Descriptive, self-explanatory |
| `Error` | Error types | Universal |
| `dry-run` | Execute without side effects | Universal CLI convention |
| `dispatch` | Programmatic full-pipeline invocation | Standard term |

## Term Hierarchy

When introducing Trails to someone new, introduce terms in this order:

**Beginner (all you need to ship):**

1. `trail()` -- a typed function with a schema
2. `Result` -- trails return Result, not exceptions
3. `topo()` -- collect trails into an app
4. `blaze()` -- open the app on CLI, MCP, or HTTP

**Intermediate (composition and enrichment):**

1. `follow` -- declare which trails a trail composes (`follow: [...]`) and invoke them at runtime (`ctx.follow()`)
2. `service()` -- define infrastructure dependencies with lifecycle and mock support
3. `event()` -- define events the app can emit
4. `metadata` -- annotate trails with metadata
5. `detours` -- define fallback paths when a trail fails

**Advanced (introspection, infrastructure, and observability):**

1. `topo` -- the internal trail collection
2. `survey` -- full introspection of the trail system (use `--brief` for quick discovery)
3. `guide` -- runtime guidance
4. `permit` -- auth and scopes
5. `loadout` -- deployment/environment config profiles
6. `crumbs` -- telemetry and trace context

**Ecosystem (multi-app and governance):**

1. `mount` -- consume another app's trails
2. `warden` -- governance and contract enforcement

## Writing Style

- Lead with code. Show `trail()` -> `topo()` -> `blaze()` before explaining it.
- Use branded terms naturally. "Define a trail" not "define an action." "Blaze on CLI" not "serve via CLI."
- Do not overdo the metaphor. "Trails is a contract-first framework" is fine. "Trails blazes a path through the wilderness" is not.
- Standard terms stay standard. "Configure the app" not "set up camp."
- The framework is "Trails" (capitalized). The primitive is "trail" (lowercase).
