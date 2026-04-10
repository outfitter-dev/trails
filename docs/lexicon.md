# Lexicon

The Trails lexicon is the curated set of terms, their definitions, and the grammar rules that govern how they compose. It is the intentional naming system of the framework — not a glossary, but a contract.

Where the lexicon and the codebase diverge, the lexicon governs and the code is brought into alignment.

See [ADR-0023: Simplifying the Trails Lexicon](adr/0023-simplifying-the-trails-lexicon.md) for the decision that produced the current shape, and [ADR-0001: Naming Conventions](adr/0001-naming-conventions.md) for the grammar rules.

## The Heuristic

One sentence governs whether a concept earns a branded term or stays plain:

> Brand when the standard word would shrink the concept in the developer's mind. Stay plain when the standard word accurately describes the scope and contract.

This means:

- **Brand is an invitation to learn something new.** The branded word signals "your existing mental model is too small for this; recalibrate." It earns its slot by naming a concept the standard word would truncate.
- **Plain is a promise that existing intuition is correct.** The plain word signals "what you already know about this term applies here." It earns its place by not forcing recalibration the framework doesn't need.
- **The mental-model slot is finite.** Every branded term costs a slot. But a standard word that anchors wrong assumptions costs more — it creates invisible confusion that compounds as the developer builds on a misunderstanding.

## Branded — Top-Level Primitives

Five terms a developer must internalize before reading a Trails app.

### `trail`

The atomic unit of work. A defined path from typed input to `Result` output. `trail(id, spec)` defines a trail.

```typescript
const show = trail('entity.show', {
  input: z.object({ name: z.string() }),
  intent: 'read',
  blaze: async (input) => Result.ok({ name: input.name }),
});
```

### `trailhead`

The entry point where the outside world reaches the trail system. CLI, MCP, HTTP, and WebSocket are trailheads.

```typescript
import { trailhead } from '@ontrails/cli/commander';
trailhead(app);

import { trailhead as mcpTrailhead } from '@ontrails/mcp';
await mcpTrailhead(app);
```

Use `trailhead` for both the one-liner function and the concept. "This app has three trailheads" is the intended sentence.

### `topo`

Collect trail modules into an app. `topo()` scans exports and builds the internal trail map with `.trails`, `.signals`, and `.resources`.

```typescript
const app = topo('myapp', entityModule, searchModule);
```

The topo is the center of gravity for discovery, validation, and runtime wiring. More than a registry — it is the queryable graph of everything: trails, relationships, signals, resources.

### `warden`

Governance and contract enforcement tooling. Active governance — completeness checking, drift detection, contract validation — not just linting. Lint rules and CI gating live here.

### `permit`

The resolved identity shape that authentication produces. A permit is the artifact the trail receives: identity, scopes, roles — typed and resolved. Auth is the boundary work; the permit is what the trail sees.

Trails declare permit requirements with the `permit` field.

## Branded — Inside `trail()` Declarations

Six terms that appear as field names inside `trail()`. The constrained context — alongside `input:`, `intent:`, `output:` — lowers the evaluation bar because the meaning is structural.

### `blaze`

The implementation field on a trail. A blaze marks what the trail actually does. A trail without a blaze is only a contract; a blazed trail is runnable.

```typescript
const create = trail('entity.create', {
  input: entityInput,
  output: entityOutput,
  resources: [db],
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    return Result.ok(await conn.create(input));
  },
});
```

"Blaze a trail" is real English, not manufactured. Only appears inside `trail()`.

### `fires`

Producer-side signal declaration. Lists the signals this trail fires.

```typescript
const create = trail('entity.create', {
  fires: [created],
  input: entityInput,
  blaze: async (input, ctx) => {
    const result = await ctx.fire(created, { id: input.id });
    return result;
  },
});
```

Pairs with `blaze` for lexicon coherence. Combined with `signal`, the resonance is mnemonic: signal fire.

### `on`

Consumer-side signal declaration. Lists the signals that activate this trail.

```typescript
const notify = trail('entity.notify', {
  on: [created],
  blaze: async (_input) => Result.ok({ delivered: true }),
});
```

`fires:` is the producer side ("this trail fires these signals"). `on:` is the consumer side ("this trail activates on this signal").

### `detour` / `detours`

Recovery paths when the trail is blocked or fails. The trail blazes forward; if blocked, it detours. Coherent pair with `blaze`.

### `cross` / `crosses`

Trail-to-trail composition. `crosses` is the declaration on the trail spec. `ctx.cross()` is the runtime call.

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

`crosses` accepts trail objects in addition to string IDs. When you pass the trail object, `ctx.cross()` becomes fully typed — the compiler infers input and output from the trail's schemas.

### `crossInput`

Composition-only input schema. Declares fields available through `ctx.cross()` but invisible to public trailheads (CLI, MCP, HTTP).

```typescript
const create = trail('gist.create', {
  input: z.object({
    description: z.string(),
    content: z.string(),
  }),
  crossInput: z.object({
    forkedFrom: z.string().optional(),
  }),
  blaze: async (input, ctx) => {
    // input.forkedFrom is available here (undefined from trailheads)
    return Result.ok({ id: '1' });
  },
});
```

`crossInput` fields are merged with `input` for the blaze. When invoked via a trailhead, `crossInput` fields are absent. When invoked via `ctx.cross()`, the caller can pass both. See [ADR-0024](adr/0024-typed-trail-composition.md).

### `signal`

A typed notification primitive defined by schema. Signals are part of the contract graph and can be fired by trails at runtime.

```typescript
const updated = signal('entity.updated', {
  payload: z.object({ id: z.string(), name: z.string() }),
});
```

Trails signals go beyond events: cron triggers, webhook sources, file watchers, bare triggers with no domain payload. "Event" would mislead; "signal" scopes correctly.

### `pin`

A named snapshot of the topo state at a point in time. Pins are stored in `trails.db` and enable comparison between the current resolved graph and a previous known-good state.

```bash
trails topo pin --name v1.0
trails topo verify
```

Carries intent that "snapshot" doesn't — "this state is my reference point." Verb-friendly. A pin captures the topo; an export serializes it.

## Plain — Standard Language

Terms that name concepts existing cleanly across software. The standard word works.

### `layer`

A cross-cutting wrapper around trail execution. Layers add behavior to the execution pipeline: dry-run, pagination, verbose, telemetry. Most layers don't block — they augment. Attaches at three levels: trail, trailhead, or topo.

```typescript
const app = topo('myapp', entityModule, {
  layers: [verboseLayer, paginationLayer],
});
```

### `resource` / `resources`

Declared infrastructure dependencies with lifecycle, mocks, and typed access.

```typescript
const db = resource('db.main', {
  create: () => Result.ok(createPool(process.env.DATABASE_URL)),
  mock: () => createMockPool(),
  dispose: (pool) => pool.end(),
});
```

### `visibility`

Whether a trail is exposed as a public verb on trailheads or kept as an internal
composition target.

```typescript
const normalizePayload = trail('github.normalize-payload', {
  visibility: 'internal',
  input: PayloadSchema,
  output: NormalizedSchema,
  blaze: async (input) => Result.ok(input),
});
```

`'public'` is the default. `'internal'` keeps the trail off trailheads unless a
specific trailhead includes that exact trail ID intentionally.

Trails declare their infrastructure needs with `resources: [...]` and access them through `db.from(ctx)` or `ctx.resource()`.

### `profile`

A named config set for a deployment environment. "Dev profile, staging profile, production profile" — universal language.

### `tracing` / `TraceRecord`

Automatic execution recording. Tracing is intrinsic to the execution pipeline. The internal record type is `TraceRecord`; the developer-facing word is just "trace."

```typescript
const result = await ctx.trace('db.query', async () => {
  return db.from(ctx).query(sql);
});
```

Industry-standard terminology, aligned with OpenTelemetry. Production observability lives in `@ontrails/observe`.

### `pattern`

A declared operational shape on a trail. Recognized structural forms — `toggle`, `crud`, `transition` — that the framework can use for derivation, governance, and agent guidance.

```typescript
const enableFeature = trail('feature.enable', {
  pattern: 'toggle',
  input: featureInput,
  blaze: async (input) => Result.ok({ enabled: true }),
});
```

### `run`

Direct programmatic execution through the full pipeline.

```typescript
const result = await run(app, 'entity.show', { id: '123' });
```

`run()` is for "invoke this specific trail now." It is not the implementation field on a trail.

### `store`

A persistence declaration. `store(definition)` declares tables with schemas, primary keys, generated fields, indexes, references, and fixtures. The store itself is connector-agnostic — bind it to a runtime (e.g., Drizzle + SQLite) to get typed accessors.

```typescript
const db = store({
  gists: {
    schema: gistSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
    indexes: ['owner'],
    fixtures: [{ owner: 'matt', description: 'Seed' }],
  },
});
```

A store is infrastructure declared as data. A resource is how that infrastructure reaches trail implementations. A store becomes usable through a resource; they are complementary, not interchangeable.

### `projection`

A mechanically derived output from authored information. The topo store is a relational projection of the resolved graph — the same data, restructured for queries. CLI flags are projections of input schemas. HTTP verbs are projections of intent. The framework derives projections; developers author the source.

### Other plain terms

| Term | Concept |
| --- | --- |
| `config` | Configuration |
| `intent` | What the trail does to the world (read, write, destroy) |
| `meta` | Annotations for tooling and filtering |
| `Result` | Ok/Err return type |
| `error` | Error types |
| `connector` | Integration-specific bridge to third-party systems (e.g., Hono, Commander, Drizzle) |
| `logger` / `logging` | Structured logging — framework provides the interface; developers bring their own |
| `health` | Health checks |
| `build*` | Derived builder output before wiring |
| `to*` / `connect*` | Runtime wiring helpers after build |

## Compound and Derived Terms

Built from the lexicon above.

| Term | Composed of | Usage |
| --- | --- | --- |
| `pack` | Collection of trails as a distributable unit | Trail pack. Published capability bundle. |
| `mount` | Cross-app composition | Mount a remote topo. Future. |
| `survey` | Full introspection of the trail system | `trails survey` to see everything. |
| `guide` | Runtime guidance layer | `trails guide` for recommendations. |

## Reserved Terms

These are directional. They should not be reused for unrelated concepts.

| Term | Concept |
| --- | --- |
| `mount` | Deployment or cross-app attachment |
| `pack` | Distributable capability bundle |
| `depot` | Registry or distribution point for packs and shared assets |
| `dispatch` | Reserved strong verb for a future concept, no longer the direct execution helper |
| `_draft.` | Reserved ID prefix for draft state. Trails, signals, and other primitives with `_draft.` IDs are visible in source but excluded from the resolved graph, established trailheads, and topo exports. Draft state is visible debt — it must never leak into established outputs. See ADR-0021. |

## Grammar

These rules carry over from ADR-0001 and govern how the lexicon composes:

- **Singular nouns define:** `trail()`, `signal()`, `resource()`
- **Plural fields declare:** `signals:`, `resources:`, `crosses:`, `layers:`, `fires:`, `on:`
- **Runtime verbs are plain actions:** `run()`, `cross()`, `signal()`
- **`create*` for runtime instances:** `createLogger()`, `createConsoleLogger()`
- **`derive*` for derivations:** `deriveFields()`, `deriveFlags()`
- **`validate*` for verification:** `validateInput()`, `validateTopo()`
- **`build*` then `to*` / `connect*` for trailhead wiring:** `buildCliCommands()`, `toCommander()`

## Term Hierarchy

When introducing Trails, use this order.

### Beginner

1. `trail()` — define a unit of work
2. `blaze:` — give the trail its implementation
3. `topo()` — collect trails into an app
4. `trailhead()` — open the app on CLI, MCP, HTTP, or WebSocket

### Intermediate

1. `run()` — execute a specific trail directly
2. `crosses` / `ctx.cross()` — compose one trail through another
3. `resource()` / `resources` — declare infrastructure dependencies
4. `signal()` — define typed notifications
5. `fires:` / `on:` — producer- and consumer-side signal declarations
6. `store()` — declare persistence with schemas, keys, and fixtures
7. `detours` and `meta` — enrich the contract

### Advanced

1. `layer` — wrap execution with cross-cutting behavior
2. `tracing` / `ctx.trace()` — record what happened
3. `permit` — auth and scopes
4. `pin` — named topo snapshot for diffing and verification
5. `projection` — mechanically derived output from authored data
6. `profile` — deployment and environment config sets
7. `pattern` — declared operational shape on a trail
8. `warden` — governance and drift detection

## Writing Style

- Lead with code: `trail()` → `blaze:` → `topo()` → `trailhead()`
- Use the lexicon consistently: "cross" instead of "follow," "trailhead" instead of "surface"
- Keep the metaphor disciplined. The words should clarify behavior, not turn the docs into theme writing.
- Prefer the lexicon's nouns even for internal architecture explanations. Leaving generic words in place only creates translation tax later.
