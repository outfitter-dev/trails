# Vocabulary

All Trails terms and their definitions. Brand the framework primitives, use plain language for everything else.

## Naming Principle

Trails-branded terms are reserved for concepts unique to the framework. Infrastructure concepts that exist in every framework keep their standard names. The test: if a developer already knows what the word means from other frameworks, do not rename it.

## Locked Terms (shipped in v1)

These are final. They appear in the public API, documentation, and code.

### `trail`

The atomic unit of work. A defined path from typed input to `Result` output. `trail(id, spec)` defines a trail.

```typescript
const show = trail('entity.show', {
  input: z.object({ name: z.string() }),
  readOnly: true,
  implementation: async (input) => Result.ok({ name: input.name }),
});
```

### `hike`

A composite trail that follows other trails via `ctx.follow()`. Has its own input/output schema but delegates work to other trails.

```typescript
const onboard = hike('entity.onboard', {
  follows: ['entity.add', 'entity.relate'],
  input: z.object({ name: z.string(), type: z.string() }),
  implementation: async (input, ctx) => {
    const added = await ctx.follow('entity.add', input);
    if (added.isErr()) return added;
    return Result.ok({ entity: added.value });
  },
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

Call another trail from within a hike's implementation. Goes through the topo with full validation and tracing.

```typescript
const result = await ctx.follow('entity.add', {
  name: 'Alpha',
  type: 'concept',
});
```

### `follows`

The declaration on a `hike()` spec listing which trails the hike follows. Verified by the warden linter.

```typescript
const myHike = hike('onboard', {
  follows: ['entity.add', 'entity.relate', 'search'],
  // ...
});
```

### `topo` (the data structure)

The internal collection of all trails -- the topography. The data structure that surfaces read, schema tools inspect, and `ctx.follow()` dispatches through. The `topo()` function returns a `Topo` object with `.trails`, `.hikes`, `.events` maps, and `.get()`, `.has()`, `.list()` accessors.

```typescript
const app = topo('myapp', entityModule);
app.trails; // ReadonlyMap of trail ID -> Trail
app.list(); // All trails and hikes
```

Most developers never interact with the topo directly. Use "the app" or "the trail collection" in introductory material.

### `implementation`

The pure function inside a trail or hike. Input in, `Result` out. Knows nothing about surfaces. Always the full word -- never "impl."

```typescript
implementation: async (input, ctx) => Result.ok(value);
```

### `survey`

Full schema introspection of the trail system. Emits the topo as structured data. Available as `trails survey` in the CLI.

### `guide`

Runtime guidance layer -- how to use these trails. Available as `trails guide` in the CLI.

### `warden`

Governance and contract enforcement tooling. Lint rules, drift detection, CI gating. Available as `trails warden` in the CLI and as `@ontrails/warden`.

### `markers`

Annotations and metadata on trails (ownership, SLA, PII). Declared as `markers` on the trail spec.

### `detours`

Error recovery and fallback paths when a trail fails. Declared as `detours` on the trail spec.

## Reserved Terms (designed, not yet shipped)

These are reserved for planned features. The naming is directional and may evolve.

| Term | Concept |
| --- | --- |
| `tracks` | Observability, telemetry, audit logs, execution history |
| `traverse` | Graph traversal, execution planning |
| `permit` | Auth and principal model. Who is allowed on which trails |
| `mount` | One-directional cross-app connection (consume another app's trails) |
| `junction` | Bidirectional peer connection between two Trails apps (future) |
| `pack` | Distributable capability bundle (trails + services + events + markers) |
| `loadout` | Deployment/environment config profile |
| `leg` | One segment of a hike's execution |
| `depot` | Pack registry and marketplace |

## Standard Terms (not branded)

These use plain language because the concepts are universal.

| Term | Concept | Why not branded |
| --- | --- | --- |
| `config` | Configuration | Every framework has config |
| `services` | Service definitions | Universal infrastructure concept |
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

1. `hike()` -- a hike follows multiple trails
2. `ctx.follow()` -- call another trail from within a hike
3. `event()` -- define events the app can emit
4. `markers` -- annotate trails with metadata
5. `detours` -- define fallback paths when a trail fails

**Advanced (introspection and observability):**

1. `topo` -- the internal trail collection
2. `survey` -- full introspection of the trail system (use `--brief` for quick discovery)
3. `guide` -- runtime guidance
4. `tracks` -- observability and telemetry

**Ecosystem (multi-app and governance):**

1. `permit` -- auth and scopes
2. `mount` -- consume another app's trails
3. `warden` -- governance and contract enforcement

## Writing Style

- Lead with code. Show `trail()` -> `topo()` -> `blaze()` before explaining it.
- Use branded terms naturally. "Define a trail" not "define an action." "Blaze on CLI" not "serve via CLI."
- Do not overdo the metaphor. "Trails is a contract-first framework" is fine. "Trails blazes a path through the wilderness" is not.
- Standard terms stay standard. "Configure the app" not "set up camp."
- The framework is "Trails" (capitalized). The primitive is "trail" (lowercase).
