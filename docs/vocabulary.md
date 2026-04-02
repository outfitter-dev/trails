# Vocabulary

The framework should read like one coherent trail system. We brand the concepts that are specific to Trails and stop carrying generic infrastructure words where they would only become rename debt later.

## Naming Principle

Use trail-native language for Trails-specific concepts, even when the old generic term would be familiar. If a word is central to how the framework is explained, taught, linted, scaffolded, or discussed, it should belong to the same vocabulary family.

## Locked Terms

These are the end-state terms. They define the public language of the framework, the docs, and the surrounding tooling.

### `trail`

The atomic unit of work. A defined path from typed input to `Result` output. `trail(id, spec)` defines a trail.

```typescript
const show = trail('entity.show', {
  input: z.object({ name: z.string() }),
  intent: 'read',
  blaze: async (input) => Result.ok({ name: input.name }),
});
```

### `blaze`

The implementation on a trail. A blaze marks what the trail actually does. A trail without a blaze is only a contract; a blazed trail is runnable.

```typescript
const create = trail('entity.create', {
  input: entityInput,
  output: entityOutput,
  provisions: [db],
  blaze: async (input, ctx) => {
    const store = db.from(ctx);
    return Result.ok(await store.create(input));
  },
});
```

### `signal`

A typed notification defined by schema. Signals are part of the contract graph and can be emitted by trails at runtime.

```typescript
const updated = signal('entity.updated', {
  payload: z.object({ id: z.string(), name: z.string() }),
});
```

### `topo`

Collect trail modules into an app. `topo()` scans exports and builds the internal trail map with `.trails`, `.signals`, and `.provisions`.

```typescript
const app = topo('myapp', entityModule, searchModule);
```

Most developers say "the app" or "the topo." The important thing is that this is the center of gravity for discovery, validation, and runtime wiring.

### `trailhead`

The entry point where the outside world reaches the trail system. CLI, MCP, HTTP, and WebSocket are trailheads.

```typescript
import { trailhead } from '@ontrails/cli/commander';
trailhead(app);

import { trailhead as mcpTrailhead } from '@ontrails/mcp';
await mcpTrailhead(app);
```

Use `trailhead` for both the one-liner function and the concept. "This app has three trailheads" is the intended sentence.

### `run`

Direct programmatic execution through the full pipeline.

```typescript
const result = await run(app, 'entity.show', { id: '123' });
```

`run()` is for "invoke this specific trail now." It is not the implementation field on a trail.

### `cross` and `crosses`

Composition between trails. `crosses` is the declaration on the trail spec. `ctx.cross()` is the runtime call.

```typescript
const onboard = trail('entity.onboard', {
  crosses: ['entity.create', 'entity.relate'],
  input: onboardingInput,
  blaze: async (input, ctx) => {
    const created = await ctx.cross('entity.create', input);
    if (created.isErr()) return created;
    return ctx.cross('entity.relate', {
      id: created.value.id,
      relatedIds: input.relatedIds,
    });
  },
});
```

The noun is a crossing: a place where one trail intentionally steps onto another trail and returns.

### `provision` and `provisions`

Infrastructure dependencies with lifecycle, mocks, and typed access.

```typescript
const db = provision('db.main', {
  create: () => Result.ok(createPool(process.env.DATABASE_URL)),
  mock: () => createMockPool(),
  dispose: (pool) => pool.end(),
});
```

Trails declare their infrastructure needs with `provisions: [...]` and access them through `db.from(ctx)` or `ctx.provision()`.

### `fires`

Activation declarations for reactive trails. A trail fires when one of its declared activators ignites.

```typescript
const notify = trail('entity.notify', {
  fires: [updated],
  blaze: async (_input) => Result.ok({ delivered: true }),
});
```

### `permit`

The resolved identity and scopes from successful authentication. Trails declare permit requirements with the `permit` field.

### `gate`

A cross-cutting wrapper around trail execution. Gates replace the generic "layer" term because they are specifically something the request passes through on the way into the system.

### `track` and `tracker`

Execution recording. A `track` is one recorded footprint. The `tracker` is the primitive that writes and reads tracks. This is infrastructure, not a cute side feature.

```typescript
import { createTrackerGate, createMemorySink } from '@ontrails/tracker';

const gate = createTrackerGate(createMemorySink());
```

### `warden`

Governance and contract enforcement tooling. Lint rules, drift detection, and CI gating live here.

### `loadout`

A named config profile for a deployment environment.

### `metadata`

Arbitrary annotations for tooling and filtering.

### `detours`

Recovery paths when a trail is blocked or fails.

## Reserved Terms

These are directional. They should not be reused for unrelated concepts.

| Term | Concept |
| --- | --- |
| `mount` | Deployment or cross-app attachment |
| `pack` | Distributable capability bundle |
| `depot` | Registry or distribution point for packs and shared assets |
| `dispatch` | Reserved strong verb for a future concept, no longer the direct execution helper |

## Standard Terms

These stay plain because they describe broadly shared ideas rather than Trails-specific primitives.

| Term | Concept |
| --- | --- |
| `config` | Configuration |
| `health` | Health checks |
| `Result` | Success/failure return type |
| `error` | Error types |
| `connector` | Integration-specific bridge to third-party systems |
| `build*` | Derived builder output before wiring |
| `to*` / `connect*` | Runtime wiring helpers after build |

## Term Hierarchy

When introducing Trails, use this order:

### Beginner

1. `trail()` — define a unit of work
2. `blaze:` — give the trail its implementation
3. `topo()` — collect trails into an app
4. `trailhead()` — open the app on CLI, MCP, HTTP, or WebSocket

### Intermediate

1. `run()` — execute a specific trail directly
2. `crosses` / `ctx.cross()` — compose one trail through another
3. `provision()` / `provisions` — declare infrastructure dependencies
4. `signal()` / `ctx.signal()` — define and emit typed notifications
5. `detours` and `metadata` — enrich the contract

### Advanced

1. `gate` — wrap execution with cross-cutting behavior
2. `tracker` / `track` — record what happened
3. `permit` — auth and scopes
4. `loadout` — deployment and environment profiles
5. `warden` — governance and drift detection

## Writing Style

- Lead with code: `trail()` -> `blaze:` -> `topo()` -> `trailhead()`
- Use the framework vocabulary consistently: "cross" instead of "follow," "trailhead" instead of "surface"
- Keep the metaphor disciplined. The words should clarify behavior, not turn the docs into theme writing.
- Prefer the new trail-native nouns even for internal architecture explanations. Leaving generic words like `surface`, `adapter`, or `Layer` behind only creates translation tax later.
