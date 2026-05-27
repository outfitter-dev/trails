# Lexicon

The Trails lexicon is the curated set of terms, their definitions, and the grammar rules that govern how they compose. It is the intentional naming system of the framework — not a glossary, but a contract.

Where the lexicon and the codebase diverge, the lexicon governs and the code is brought into alignment.

See [ADR-0023: Simplifying the Trails Lexicon](adr/0023-simplifying-the-trails-lexicon.md) for the decision that produced the current shape, [ADR-0001: Naming Conventions](adr/0001-naming-conventions.md) for the grammar rules, and [Language Styleguide](contributing/language-styleguide.md) for prose guidance.

## The Heuristic

One sentence governs whether a concept earns a branded term or stays plain:

> Brand when the standard word would shrink the concept in the developer's mind. Stay plain when the standard word accurately describes the scope and contract.

This means:

- **Brand is an invitation to learn something new.** The branded word signals "your existing mental model is too small for this; recalibrate." It earns its slot by naming a concept the standard word would truncate.
- **Plain is a promise that existing intuition is correct.** The plain word signals "what you already know about this term applies here." It earns its place by not forcing recalibration the framework doesn't need.
- **The mental-model slot is finite.** Every branded term costs a slot. But a standard word that anchors wrong assumptions costs more — it creates invisible confusion that compounds as the developer builds on a misunderstanding.

## Branded — Top-Level Primitives

Six terms a developer must internalize before reading a Trails app.

### `trail`

The atomic unit of work. A defined path from typed input to `Result` output. `trail(id, spec)` defines a trail.

```typescript
const show = trail('entity.show', {
  input: z.object({ name: z.string() }),
  intent: 'read',
  blaze: async (input) => Result.ok({ name: input.name }),
});
```

### `surface`

The boundary-owned rendering where the outside world reaches the trail system. CLI, MCP, HTTP, and WebSocket are surfaces.

```typescript
import { surface } from '@ontrails/commander';
await surface(graph);

import { surface as surfaceMcp } from '@ontrails/mcp';
await surfaceMcp(graph);
```

Use `surface` for both the one-liner function and the concept. "This app has three surfaces" is the intended sentence.

### `topo`

Collect trail modules into a graph. `topo()` scans exports and builds the internal trail map with `.trails`, `.signals`, and `.resources`.

```typescript
const graph = topo('myapp', entityModule, searchModule);
```

The topo is the center of gravity for discovery, validation, and runtime wiring. More than a registry — it is the queryable graph of everything: trails, relationships, signals, resources. The primitive is `topo()`. The value it returns is a graph.

### `contour`

A first-class domain object with schema, identity, and examples. `contour()` defines the shape of a thing in the domain so trails, stores, tests, and topology tooling can all derive from the same authored source.

```typescript
const gist = contour('gist', {
  id: shortId(),
  description: z.string(),
  content: z.string(),
});
```

A contour is a node in the domain graph. Trails operate on contours. Stores persist contours. Survey and governance can reason about contours as nouns rather than inferring them from repeated trail prefixes.

### `warden`

Governance and contract enforcement tooling. Active governance — completeness checking, drift detection, contract validation — not just linting. Lint rules and CI gating live here.

### `topographer`

The durable graph substrate. `@ontrails/topographer` owns the artifacts derived from the resolved graph that survive across processes or compare state across time: TopoGraphs, hashes, semantic diffs, lock manifest and `topo.lock` I/O, snapshots, and pinned history. Core resolves the graph; Topographer persists and compares it.

A package needs Topographer only when it crosses a process boundary or compares state across time. The runtime never reads Topographer artifacts to execute trails — every `topo()` call resolves entirely in core. See [ADR-0042](adr/0042-core-topographer-boundary-doctrine.md) for the boundary doctrine.

### TopoGraph Artifact Family

These names are the current durable artifact-family vocabulary established by [ADR-0046](adr/0046-lock-v3-artifact-family.md).

#### `TopoGraph`

The exported TypeScript type family for the serialized, inspectable graph content. A TopoGraph contains trail, signal, resource, contour, activation, schema, layer, example, and surface-projection facts. It is the content artifact written to `.trails/topo.lock`.

#### `topoGraph`

The JavaScript field and variable spelling for a TopoGraph value, for example `stored.topoGraph`, `topoGraphJson`, or `deriveTopoGraph(graph)`.

#### `topo_graph`

The SQL/storage spelling for serialized TopoGraph content. In the topo store, `topo_exports.topo_graph` holds the graph content that corresponds to `.trails/topo.lock`.

#### `lock_manifest`

The SQL/storage spelling for the stored lock manifest export. The manifest is the compact `.trails/trails.lock` artifact that points at `topo.lock` and verifies the TopoGraph hash; it is not a second copy of the graph.

#### `.trails/state/`

Ignored mutable runtime state. The default local SQLite database lives at `.trails/state/trails.db`; its `-wal` and `-shm` sidecars are transient local state and must not be committed.

#### `.trails/cache/`

Ignored rebuildable cache state. Generated helper artifacts that can be rebuilt from source contracts belong here rather than beside committed lock artifacts.

#### `.trails/config.local.{ts,js}`

Ignored per-developer config overrides. Use `.trails/config.local.ts` or `.trails/config.local.js`; do not create nested `.trails/config/local.*` files.

#### Retired Vocabulary

These names are historical or migration vocabulary, not current target-state language for active docs, examples, or agent guidance:

| Retired | Current |
| --- | --- |
| `SurfaceMap` | `TopoGraph` |
| `SurfaceMapEntry` | `TopoGraphEntry` |
| `_surface.json` | `.trails/topo.lock` |
| `surface_map` | `topo_graph` |
| `cross` / `crosses` | `compose` / `composes` |
| `crossInput` | `composeInput` |
| `serialized_lock` | `lock_manifest` when referring to stored manifest export content; `.trails/trails.lock` when referring to the committed manifest file |
| `.trails/config/local` | `.trails/config.local.{ts,js}` |
| `.trails/trails.db` | `.trails/state/trails.db` |
| `.trails/trails.db-shm` / `.trails/trails.db-wal` | `.trails/state/trails.db-shm` / `.trails/state/trails.db-wal` |
| `.trails/dev/` | `.trails/state/` for mutable runtime state |
| `.trails/generated/` | `.trails/cache/` for rebuildable generated state |

Historical release notes, old migrations, accepted ADR history, and explicitly superseded planning archives may mention retired names when the surrounding text clearly marks them as legacy. Active guidance should teach the current names.

### `permit`

The resolved identity shape that authentication produces. A permit is the artifact the trail receives: identity, scopes, roles — typed and resolved. Auth is the boundary work; the permit is what the trail sees.

Trails declare permit requirements with the `permit` field.

## Branded — Inside `trail()` Declarations

Six terms that appear as field names inside `trail()`. The constrained context — alongside `input:`, `intent:`, `output:` — lowers the evaluation bar because the meaning is structural.

### `blaze`

The authored implementation that makes a trail runnable.

A trail can be specified before it is blazed: schemas, examples, intent, resources, compositions, signals, detours, and metadata can all exist as contract. The `blaze` establishes the path through that contract, from validated input to `Result` output.

The runtime runs trails, not blazes. A blazed trail can be exposed through any surface because its implementation is surface-agnostic: input in, `Result` out.

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

"Blaze a trail" is real English, not manufactured. In Trails, it means establishing the trail for use, not walking it. See [Language Styleguide](contributing/language-styleguide.md#blaze) for the full grammar.

### `fires`

Producer-side signal declaration. Lists the signals this trail fires.

```typescript
const create = trail('entity.create', {
  fires: [created],
  input: entityInput,
  blaze: async (input, ctx) => {
    await ctx.fire(created, { id: input.id });
    return Result.ok({ id: input.id });
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

Recovery paths when the trail is blocked or fails. A blazed trail proceeds through the normal path; if blocked, it detours. Coherent pair with `blaze`.

### `compose` / `composes`

Trail-to-trail composition. `composes` is the declaration on the trail spec. `ctx.compose()` is the runtime call.

```typescript
const onboard = trail('entity.onboard', {
  composes: ['entity.create', 'entity.relate'],
  input: onboardingInput,
  blaze: async (input, ctx) => {
    const created = await ctx.compose('entity.create', input);
    if (created.isErr()) return created;
    return ctx.compose('entity.relate', {
      id: created.value.id,
      relatedIds: input.relatedIds,
    });
  },
});
```

The noun is a composition: one trail intentionally incorporates another trail's execution.

`composes` accepts trail objects in addition to string IDs. When you pass the trail object, `ctx.compose()` becomes fully typed — the compiler infers input and output from the trail's schemas.

### `composeInput`

Composition-only input schema. Declares fields available through `ctx.compose()` but invisible to public surfaces (CLI, MCP, HTTP).

```typescript
const create = trail('gist.create', {
  input: z.object({
    description: z.string(),
    content: z.string(),
  }),
  composeInput: z.object({
    forkedFrom: z.string().optional(),
  }),
  blaze: async (input, ctx) => {
    // input.forkedFrom is available here (undefined from surfaces)
    return Result.ok({ id: '1' });
  },
});
```

`composeInput` fields are merged with `input` for the blaze. When invoked via a surface, `composeInput` fields are absent. When invoked via `ctx.compose()`, the caller can pass both. See [ADR-0024](adr/0024-typed-trail-composition.md).

### `signal`

A typed notification primitive defined by schema. Signals are part of the contract graph and can be fired by trails at runtime.

```typescript
const updated = signal('entity.updated', {
  payload: z.object({ id: z.string(), name: z.string() }),
});
```

Trails signals are authored, typed notifications in the contract graph. Schedule and webhook activation sources are separate `on:` source objects: schedules are materialized by the schedule runtime, and webhooks are materialized by the HTTP surface through the universal `webhook()` source shape. File watchers and other external activation sources remain future source kinds.

### `pin`

A named snapshot of the graph state at a point in time. Pins are stored in the shared `trails.db` at `.trails/state/trails.db` and enable comparison between the current resolved graph and a previous known-good state.

```bash
trails topo pin --name v1.0
trails validate
```

Carries intent that "snapshot" doesn't — "this state is my reference point." Verb-friendly. A pin captures the graph; an export serializes it.

## Plain — Standard Language

Terms that name concepts existing cleanly across software. The standard word works.

### Scope of Branded-Role Enforcement

Lexicon enforcement is role-scoped. The framework bans generic synonyms when a word is claiming the canonical slot for a Trails concept, not whenever the word appears in ordinary explanation.

A substitution claim should use the Trails term. For example, code or docs should not describe a `topo` as a registry, a `trail` as an action, a `blaze` as a handler, or a `surface` as transport terminology when the sentence is naming the framework concept itself.

A mention can use the external or generic word when it is doing a different job: contrasting Trails with another system, naming an upstream library concept, quoting external API vocabulary, or explaining why a standard word is not the Trails term. The sentence "MCP calls these tools, while Trails authors trails" is a valid mention; the sentence "register this action in the topo" is a substitution and should be corrected.

When in doubt, ask whether the word is occupying the Trails concept's canonical noun slot. If yes, use the lexicon. If it is apposition, contrast, quotation, or external-system vocabulary, keep the sentence accurate and avoid theatrical rewriting.

### `layer`

A typed cross-cutting wrapper around one trail execution. A layer can declare an `input` schema for surface-visible behavior, or omit `input` to stay invisible to surfaces. Layers can attach at trail, surface, topo, or execution-call scope. They are not standalone graph nodes; they are execution wrappers whose declared inputs can still be projected and governed.

```typescript
await surface(graph, {
  layers: [rateLimitLayer, telemetryLayer],
});
```

Use layers for authored behavior such as rate limits, tenant guards, telemetry wrappers, or CLI verbosity. Framework-owned behavior such as permit enforcement and tracing stays in the execution pipeline. See [ADR-0043: Layer Evolution](./adr/0043-layer-evolution.md).

### `resource` / `resources`

Declared infrastructure dependencies with lifecycle, mocks, and typed access.

```typescript
const db = resource('db.main', {
  create: () => Result.ok(createPool(process.env.DATABASE_URL)),
  mock: () => createMockPool(),
  dispose: (pool) => pool.end(),
});
```

Trails declare their infrastructure needs with `resources: [...]` and access them through `db.from(ctx)` or `ctx.resource()`.

### `visibility`

Whether a trail is exposed as a public verb on surfaces or kept as an internal composition target.

```typescript
const normalizePayload = trail('github.normalize-payload', {
  visibility: 'internal',
  input: PayloadSchema,
  output: NormalizedSchema,
  blaze: async (input) => Result.ok(input),
});
```

`'public'` is the default. `'internal'` keeps the trail off surfaces unless a specific surface includes that exact trail ID intentionally.

### `profile`

A named config set for a deployment environment. "Dev profile, staging profile, production profile" — universal language.

### `tracing` / `TraceRecord`

Automatic execution recording. Tracing is intrinsic to the execution pipeline. The internal record type is `TraceRecord`; records can describe trail execution, spans, signal lifecycle entries, and activation boundaries. The developer-facing word is just "trace."

```typescript
const result = await ctx.trace('db.query', async () => {
  return db.from(ctx).query(sql);
});
```

Industry-standard terminology, aligned with OpenTelemetry. Production observability lives in `@ontrails/observe`.

### `pattern`

A declared operational shape on a trail. Recognized structural forms — `crud`, `sync`, `reconcile`, `ingest`, `toggle`, `transition` — that the framework can use for derivation, governance, and agent guidance. First-party factories stamp the patterns they own; lower-level helpers like `deriveTrail()` stay neutral unless the caller declares one explicitly.

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
const result = await run(graph, 'entity.show', { id: '123' });
```

`run()` is for "invoke this specific trail now." It is not the authored `blaze` on a trail.

### `version` / `versions`

Trail-only contract evolution fields. `version: N` declares the current version number on a trail. `versions: { N: ... }` declares explicit historical version entries for that same trail.

```typescript
const create = trail('invite.create', {
  input: currentInput,
  output: currentOutput,
  blaze: currentBlaze,
  version: 3,
  versions: {
    2: { input: v2Input, output: v2Output, transpose: v2Transpose },
  },
});
```

The current contract stays top-level. Historical entries must declare `input` and `output`; they do not inherit from current. In v1, this shape belongs only to trails. Non-trail primitives reserve the field name for future primitive-specific designs.

### `revision` / `fork`

Kinds of trail version entries, projected by the resolved graph rather than authored as a source `kind:` field.

A **revision** has `transpose:` and uses pure data transforms into and out of current. The current blazed trail still runs.

A **fork** has its own `blaze:` and may own `composes`, `resources`, and `detours` because its historical blazed trail runs for that version.

### `transpose`

The schema-transform field on a revision entry. It is a pure `{ input, output }` pair for translating data between one historical contract and current.

`transpose` is not an adapter. `adapter` names a package or subpath that connects Trails to an external library, framework, tool, platform, format, or ecosystem. `transpose` is local version-entry grammar.

### `status`

Lifecycle metadata on a historical version entry. Absence means active. Supported v1 states are `deprecated` and `archived`.

Deprecated entries remain live. Archived entries remain inspectable but do not resolve at runtime by default.

### `marker`

A framework-projected, content-addressed contract identifier. Authors do not write `marker:` in source. The resolved graph stores a 16-character SHA-256 prefix and surfaces display the shortest unambiguous prefix with a minimum of four characters.

### `@N` / `(trail, version)`

`trail.id@2` is a version reference. `trail.id@<marker-prefix>` is a marker reference when the prefix is unambiguous. The `(trail, version)` pair is the contract-resolution unit; a bare trail ID means current.

### `forces`

Compiler-managed graph audit records for future `--force` compile behavior. `forces:` appears only in the resolved graph, not in source, and is not a version entry.

### `graph`

The assembled, queryable value returned by `topo()`. The graph is the runtime shape that surfaces render, survey inspects, and the TopoGraph artifact family serializes for review.

```typescript
const graph = topo('myapp', entityModule, searchModule);
await surface(graph);
```

### `store`

A persistence declaration. `store(definition)` declares what is persisted for a domain object — schema, identity, generated fields, relationships, and fixtures — without choosing how that persistence is realized. The store itself is backend-agnostic. An adapter binding interprets it for a specific backend and persistence shape.

```typescript
const db = store({
  gists: {
    schema: gistSchema,
    identity: 'id',
    generated: ['id', 'createdAt'],
    fixtures: [{ owner: 'matt', description: 'Seed' }],
  },
});
```

A store is infrastructure declared as data. A resource is how that infrastructure reaches blazes. A store becomes usable through a resource; they are complementary, not interchangeable.

### `kind`

The plain word for the persistence shape an adapter binds a store through. Current examples include `tabular`, `document`, `file`, `kv`, and `cache`.

The store declaration stays kind-agnostic. The adapter or binding chooses the kind and interprets the store schema accordingly.

### `projection`

A mechanically derived output from authored information. The topo store is a relational projection of the resolved graph — the same data, restructured for queries. CLI flags are projections of input schemas. HTTP verbs are projections of intent. `deriveCliCommands(graph)` and `deriveHttpRoutes(graph)` are surface projections. The framework derives projections; developers author the source.

### Other plain terms

| Term | Concept |
| --- | --- |
| `config` | Configuration |
| `intent` | What the trail does to the world (read, write, destroy) |
| `meta` | Annotations for tooling and filtering |
| `Result` | Ok/Err return type |
| `error` | Error types |
| `adapter` | Canonical public category for a package or subpath that connects Trails to a named external library, framework, tool, platform, format, or ecosystem |
| `facet` | Projection slice of authored contract or surface data, such as a surface facet or schema facet; not a package category |
| `integration (colloquial)` | Ordinary English for places Trails integrates with an external system; not a public taxonomy category |
| `logger` / `logging` | Structured logging — framework provides the interface; developers bring their own |
| `health` | Health checks |
| `derive*` | Mechanically project surface definitions from a graph |
| `create*` | Materialize runtime objects without opening the boundary |
| `to*` / `connect*` | Narrow translation or transport helpers where the boundary package needs them |

## Compound and Derived Terms

Built from the lexicon above.

| Term | Composed of | Usage |
| --- | --- | --- |
| `pack` | Collection of trails as a distributable unit | Trail pack. Published capability bundle. |
| `mount` | Cross-app composition | Mount a remote graph. Future. |
| `survey` | Full introspection of the trail system | `trails survey` for an overview; `trails survey <id>` or `trails survey trail <id>` for focused detail. |
| `guide` | Runtime guidance layer | `trails guide` for recommendations. |

## Reserved Terms

These are directional. They should not be reused for unrelated concepts.

| Term | Concept |
| --- | --- |
| `mount` | Deployment or cross-app attachment |
| `pack` | Distributable capability bundle |
| `depot` | Registry or distribution point for packs and shared assets |
| `dispatch` | Activation/source fan-out from a source to consuming trails; not the direct execution helper |
| `trailhead` | Historical boundary term retired from active user-facing vocabulary. Use `surface` in docs, examples, and public APIs. |
| `connector` | Historical package-boundary term retired from active user-facing taxonomy. Use `adapter` in docs, examples, and public APIs. |
| `_draft.` | Reserved ID prefix for draft state. Trails, signals, and other primitives with `_draft.` IDs are visible in source but excluded from the resolved graph, established surfaces, and graph exports. Draft state is visible debt — it must never leak into established outputs. See ADR-0021. |

## Grammar

These rules carry over from ADR-0001 and govern how the lexicon composes:

- **Singular nouns define:** `trail()`, `signal()`, `resource()`
- **Plural fields declare:** `signals:`, `resources:`, `composes:`, `fires:`, `on:`
- **Runtime verbs are plain actions:** `run()`, `ctx.compose()`, `ctx.fire()`
- **`create*` for runtime instances:** `createLogger()`, `createConsoleLogger()`
- **`derive*` for derivations:** `deriveFields()`, `deriveFlags()`
- **`validate*` for verification:** `validateInput()`, `validateTopo()`
- **`derive*` then `create*` then `surface()` for surface wiring:** `deriveCliCommands()`, `createProgram()`, `surface()`

## Term Hierarchy

When introducing Trails, use this order.

### Beginner

1. `trail()` — define a unit of work
2. `blaze:` — establish how the trail runs
3. `topo()` — collect trails into a graph
4. `surface()` — open the graph on CLI, MCP, HTTP, or WebSocket

### Intermediate

1. `run()` — execute a specific trail directly
2. `composes` / `ctx.compose()` — compose one trail through another
3. `resource()` / `resources` — declare infrastructure dependencies
4. `signal()` — define typed notifications
5. `fires:` / `on:` — producer- and consumer-side signal declarations
6. `store()` — declare persistence with schemas, keys, and fixtures
7. `detours` and `meta` — enrich the contract

### Advanced

1. `layer` — wrap execution at trail, surface, topo, or execution-call scope
2. `tracing` / `ctx.trace()` — record what happened
3. `permit` — auth and scopes
4. `pin` — named graph snapshot for diffing and verification
5. `projection` — mechanically derived output from authored data
6. `profile` — deployment and environment config sets
7. `pattern` — declared operational shape on a trail
8. `warden` — governance and drift detection

## Writing Style

- Lead with code: `trail()` → `blaze:` → `topo()` → `surface()`
- Use the lexicon consistently: "compose" instead of "cross," "surface"
  instead of generic transport vocabulary
- Keep the metaphor disciplined. The words should clarify behavior, not turn the docs into theme writing.
- Prefer the lexicon's nouns even for internal architecture explanations. Leaving generic words in place only creates translation tax later.
- Use `implementation` to clarify `blaze`, not to replace it as the concept. A blazed trail is a runnable contract.
