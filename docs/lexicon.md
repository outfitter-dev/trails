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
  implementation: async (input) => Result.ok({ name: input.name }),
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

### `entity`

A first-class domain object with schema, identity, and examples. `entity()` defines the shape of a thing in the domain so trails, stores, tests, and topology tooling can all derive from the same authored source.

```typescript
const gist = entity('gist', {
  id: shortId(),
  description: z.string(),
  content: z.string(),
}, {
  identity: 'id',
});
```

An entity is a node in the domain graph. Trails operate on entities. Stores persist entities. Survey and governance can reason about entities as nouns rather than inferring them from repeated trail prefixes.

### `warden`

Governance and contract enforcement tooling. Active governance — completeness checking, drift detection, contract validation — not just linting. Lint rules and CI gating live here.

### `topography`

The durable graph substrate. `@ontrails/topography` owns the artifacts derived from the resolved graph that survive across processes or compare state across time: TopoGraphs, hashes, semantic diffs, `trails.lock` I/O, snapshots, and pinned history. Core resolves the graph; Topography persists and compares it.

A package needs Topography only when it crosses a process boundary or compares state across time. The runtime never reads Topography artifacts to execute trails — every `topo()` call resolves entirely in core. See [ADR-0042](adr/0042-core-topography-boundary-doctrine.md) for the boundary doctrine.

### TopoGraph Lock

These names are the current durable graph-artifact vocabulary.

#### `TopoGraph`

The exported TypeScript type family for the serialized, inspectable graph content. A TopoGraph contains trail, signal, resource, entity, activation, schema, layer, example, and surface-rendering facts. It is embedded in root `trails.lock`.

#### `topoGraph`

The JavaScript field and variable spelling for a TopoGraph value, for example `stored.topoGraph`, `topoGraphJson`, or `deriveTopoGraph(graph)`.

#### `topo_graph`

The SQL/storage spelling for serialized TopoGraph content. In the topo store, `topo_exports.topo_graph` holds the graph content that corresponds to the TopoGraph embedded in `trails.lock`.

#### `lock_manifest`

The SQL/storage spelling for the stored manifest export. The manifest is historical compatibility data for the beta artifact family and internal topo-store snapshots; the committed v1 `trails.lock` file embeds the graph instead of pointing at a second committed file.

#### `trails.lock`

The committed resolved-truth file at a Trails project root. It embeds the serialized TopoGraph plus the graph hash, summary, scope, and lock schema version. It is derived, but committed because its diff is governance.

#### `.trails/`

Committed Trails control directory. Use it for project-local Warden rules and other framework-owned control sections that do not deserve root filenames. Do not put generated state, cache, SQLite databases, or lock fragments here.

#### Trails state store

Per-user mutable runtime state. The default local SQLite database lives under `$TRAILS_STATE_HOME/trails/projects/<project-key>/trails.db`, then `$XDG_STATE_HOME`, then `~/.local/state`. Its `-wal` and `-shm` sidecars are transient local state and must not be committed.

#### Trails cache store

Per-user rebuildable cache state. Cache artifacts that can be rebuilt from source contracts belong in the global Trails cache tier, not beside committed lock artifacts or under `.trails/`.

#### `trails.config.local.*`

Ignored per-developer config overrides. Use `trails.config.local.ts`, `trails.config.local.mts`, `trails.config.local.js`, `trails.config.local.mjs`, `trails.config.local.json`, `trails.config.local.jsonc`, `trails.config.local.yaml`, or `trails.config.local.toml` at the project root; do not create `.trails/config.local.*` or nested `.trails/config/local.*` files.

#### Retired Vocabulary

These names are historical or migration vocabulary, not current target-state language for active docs, examples, or agent guidance:

| Retired | Current |
| --- | --- |
| `SurfaceMap` | `TopoGraph` |
| `SurfaceMapEntry` | `TopoGraphEntry` |
| `_surface.json` | `trails.lock` |
| `surface_map` | `topo_graph` |
| `contour` / `contours` | `entity` / `entities` |
| `cross` / `crosses` | `compose` / `composes` |
| `crossInput` | `composeInput` |
| `topographer` | `topography` |
| `serialized_lock` | `lock_manifest` when referring to stored manifest export content; `trails.lock` when referring to the committed resolved-truth file |
| `.trails/config/local.*` | `trails.config.local.*` |
| `.trails/config.local.*` | `trails.config.local.*` |
| `.trails/trails.lock` / `.trails/topo.lock` | `trails.lock` |
| `.trails/trails.db` | Trails state store `trails.db` |
| `.trails/trails.db-shm` / `.trails/trails.db-wal` | Trails state store SQLite sidecars |
| `.trails/state/` / `.trails/dev/` | Trails state store for mutable runtime state |
| `.trails/cache/` / `.trails/generated/` | Trails cache store for rebuildable generated state |

Historical release notes, old migrations, accepted ADR history, and explicitly superseded planning archives may mention retired names when the surrounding text clearly marks them as legacy. Active guidance should teach the current names.

### `permit`

The resolved identity shape that authentication produces. A permit is the artifact the trail receives: identity, scopes, roles — typed and resolved. Auth is the boundary work; the permit is what the trail sees.

Trails declare permit requirements with the `permit` field.

## Inside `trail()` Declarations

Terms that appear as field names inside `trail()`. The constrained context — alongside `input:`, `intent:`, `output:` — makes the meaning structural.

### `implementation`

The authored behavior that makes a trail runnable.

A trail can be specified before its implementation is complete: schemas, examples, intent, resources, compositions, signals, detours, and metadata can all exist as contract. The `implementation` establishes the path through that contract, from validated input to `Result` output.

The runtime runs trails, not bare implementation functions. A trail with an implementation can be exposed through any surface because its implementation is surface-agnostic: input in, `Result` out.

```typescript
const create = trail('entity.create', {
  input: entityInput,
  output: entityOutput,
  resources: [db],
  implementation: async (input, ctx) => {
    const conn = db.from(ctx);
    return Result.ok(await conn.create(input));
  },
});
```

"Blaze a trail" remains useful ordinary English for establishing a path, but it is no longer framework vocabulary. See [Language Styleguide](contributing/language-styleguide.md#implementation) for the full grammar.

### `fires`

Producer-side signal declaration. Lists the signals this trail fires.

```typescript
const create = trail('entity.create', {
  fires: [created],
  input: entityInput,
  implementation: async (input, ctx) => {
    await ctx.fire(created, { id: input.id });
    return Result.ok({ id: input.id });
  },
});
```

Combined with `signal`, the resonance is mnemonic: signal fire.

### `on`

Consumer-side signal declaration. Lists the signals that activate this trail.

```typescript
const notify = trail('entity.notify', {
  on: [created],
  implementation: async (_input) => Result.ok({ delivered: true }),
});
```

`fires:` is the producer side ("this trail fires these signals"). `on:` is the consumer side ("this trail activates on this signal").

### `detour` / `detours`

Recovery paths when the trail is blocked or fails. A runnable trail proceeds through the normal path; if blocked, it detours.

### `compose` / `composes`

Trail-to-trail composition. `composes` is the declaration on the trail spec. `ctx.compose()` is the runtime call.

```typescript
const onboard = trail('entity.onboard', {
  composes: ['entity.create', 'entity.relate'],
  input: onboardingInput,
  implementation: async (input, ctx) => {
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
  implementation: async (input, ctx) => {
    // input.forkedFrom is available here (undefined from surfaces)
    return Result.ok({ id: '1' });
  },
});
```

`composeInput` fields are merged with `input` for the implementation. When invoked via a surface, `composeInput` fields are absent. When invoked via `ctx.compose()`, the caller can pass both. See [ADR-0024](adr/0024-typed-trail-composition.md).

### `signal`

A typed notification primitive defined by schema. Signals are part of the contract graph and can be fired by trails at runtime.

```typescript
const updated = signal('entity.updated', {
  payload: z.object({ id: z.string(), name: z.string() }),
});
```

Trails signals are authored, typed notifications in the contract graph. Schedule and webhook activation sources are separate `on:` source objects: schedules are materialized by the schedule runtime, and webhooks are materialized by the HTTP surface through the universal `webhook()` source shape. File watchers and other external activation sources remain future source kinds.

### `pin`

A named snapshot of the graph state at a point in time. Pins are stored in the shared local `trails.db` in the Trails state store and enable comparison between the current resolved graph and a previous known-good state.

```bash
trails topo pin --name v1.0
trails validate
```

Carries intent that "snapshot" doesn't — "this state is my reference point." Verb-friendly. A pin captures the graph; an export serializes it.

## Plain — Standard Language

Terms that name concepts existing cleanly across software. The standard word works.

### Scope of Branded-Role Enforcement

Lexicon enforcement is role-scoped. The framework bans generic synonyms when a word is claiming the canonical slot for a Trails concept, not whenever the word appears in ordinary explanation.

A substitution claim should use the Trails term. For example, code or docs should not describe a `topo` as a registry, a `trail` as an action, an `implementation` as a handler, or a `surface` as transport terminology when the sentence is naming the framework concept itself.

A mention can use the external or generic word when it is doing a different job: contrasting Trails with another system, naming an upstream library concept, quoting external API vocabulary, or explaining why a standard word is not the Trails term. The sentence "MCP calls these tools, while Trails authors trails" is a valid mention; the sentence "register this action in the topo" is a substitution and should be corrected.

When in doubt, ask whether the word is occupying the Trails concept's canonical noun slot. If yes, use the lexicon. If it is apposition, contrast, quotation, or external-system vocabulary, keep the sentence accurate and avoid theatrical rewriting.

### `layer`

A typed cross-cutting wrapper around one trail execution. A layer can declare an `input` schema for surface-visible behavior, or omit `input` to stay invisible to surfaces. Layers can attach at trail, surface, topo, or execution-call scope. They are not standalone graph nodes; they are execution wrappers whose declared inputs can still be projected and governed.

```typescript
await surface(graph, {
  layers: [rateLimitLayer, telemetryLayer],
});
```

Use layers for authored behavior such as rate limits, tenant guards, telemetry wrappers, or CLI verbosity. Framework-owned behavior such as permit enforcement and tracing stays in the execution pipeline. Layers contrast with [`overlay`](#overlay): layers wrap what runs; overlays enrich the map. See [ADR-0043: Layer Evolution](./adr/0043-layer-evolution.md).

### `overlay`

A named, schema-registered, provenance-tagged sheet of facts laid over the topo. An overlay contributes facts under one lock namespace — the app-authored `surfaces` overlay carries CLI and MCP bindings, and adapters contribute their own namespaces — and readers are tolerant: overlay facts are additive, and a consumer that does not understand a namespace ignores it without breaking.

```typescript
export const trailsOverlays = [
  surfaceOverlay({
    cli: { ls: 'gear.list' },
    mcp: { snippets: ['snippet.create', 'snippet.get'] },
  }),
];
```

Overlays contrast with [`layer`](#layer): layers wrap what runs; overlays enrich the map. An overlay is never a subdivision of an individual trail — it lays facts over the whole graph, keyed by namespace, and trail contracts stay whole underneath it.

Known homophone: the app module export is named `trailsOverlays` because app-module exports carry the `trails*` prefix convention. That export is a collection of overlay envelopes, not a separate concept.

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
  implementation: async (input) => Result.ok(input),
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
  implementation: async (input) => Result.ok({ enabled: true }),
});
```

### `run`

Direct programmatic execution through the full pipeline.

```typescript
const result = await run(graph, 'entity.show', { id: '123' });
```

`run()` is for "invoke this specific trail now." It is not the authored `implementation` on a trail.

### `version` / `versions`

Trail-only contract evolution fields. `version: N` declares the current version number on a trail. `versions: { N: ... }` declares explicit historical version entries for that same trail.

```typescript
const create = trail('invite.create', {
  input: currentInput,
  output: currentOutput,
  implementation: currentImplementation,
  version: 3,
  versions: {
    2: { input: v2Input, output: v2Output, transpose: v2Transpose },
  },
});
```

The current contract stays top-level. Historical entries must declare `input` and `output`; they do not inherit from current. In v1, this shape belongs only to trails. Non-trail primitives reserve the field name for future primitive-specific designs.

### `revision` / `fork`

Kinds of trail version entries, projected by the resolved graph rather than authored as a source `kind:` field.

A **revision** has `transpose:` and uses pure data transforms into and out of current. The current implementation still runs.

A **fork** has its own `implementation:` and may own `composes`, `resources`, and `detours` because its historical implementation runs for that version.

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

The assembled, queryable value returned by `topo()`. The graph is the runtime shape that surfaces render, survey inspects, and the root `trails.lock` serializes for review.

```typescript
const graph = topo('myapp', entityModule, searchModule);
await surface(graph);
```

### `store`

A persistence declaration. `store(definition)` declares what is persisted for a domain object — schema, identity, generated fields, relationships, and fixtures — without choosing how that persistence is realized. The store itself is backend-agnostic. A binding (native or adapter) interprets it for a specific backend and persistence shape.

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

A store is infrastructure declared as data. A resource is how that infrastructure reaches implementations. A store becomes usable through a resource; they are complementary, not interchangeable.

### `binding`

A concrete realization of an authored Trails declaration or contract against a backend, runtime, tool, surface, or publisher. `binding` is the genus; the ADR-0029 dependency-boundary test sets the kind:

- **`native binding`** — Trails-owned, built-in path (subpath or same package) that uses only the ambient runtime or a Trails-owned mechanism and crosses no foreign tool or framework boundary. `@ontrails/http/fetch` and `@ontrails/http/bun` are native HTTP bindings.
- **`adapter binding`** — an extracted package or integration that crosses into a third-party or foreign framework, tool, or runtime contract. `@ontrails/hono` is an adapter binding.

Merely reading authored input — for example, consuming `.changeset/*.md` as release intent — is neither kind. That is just consuming input.

In prose, prefer qualified forms such as `native binding`, `adapter binding`, `surface binding`, `store binding`, and `release binding` so the bare word does not collide with local-variable or import "binding" noise in Warden and source-analysis contexts.

Both kinds may share the **adapter seam**: the paved scaffold plus conformance extension point. The adapter seam is the shared extension and conformance path, not the public noun for every binding — a native binding is not called "an adapter" in prose. Use "materializer" only when quoting existing HTTP implementation or ADR wording. See [Script Graduation](contributing/script-graduation.md) for how bindings fit the graduation doctrine.

### `kind`

The plain word for the persistence shape a binding realizes a store through. Current examples include `tabular`, `document`, `file`, `kv`, and `cache`.

The store declaration stays kind-agnostic. The binding (native or adapter) chooses the kind and interprets the store schema accordingly.

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
| `diagnostic` | Analyzer-reported problem or guidance item emitted by Warden, config checks, validation, or similar tooling. Do not use `issue`, `finding`, or `violation` as the framework noun for this shape. |
| `adapter` | Canonical public category for a package or subpath that connects Trails to a named external library, framework, tool, platform, format, or ecosystem |
| `surface accommodation` | Projection-level fit adjustment that lets a surface feel native without changing the trail contract |
| `surface entry` | Invocable affordance exposed by a surface: CLI command, MCP tool, HTTP route, or library export |
| `approach` | Surface-specific way for a caller to reach a surface entry |
| `path` | Surface-local realization of an approach: command path, tool name, HTTP path, or export name |
| `alias` | Prose/teaching word for a scalar surface binding: an alternate approach converging on the same surface entry and trail contract. Authored through `surfaceOverlay()` scalar bindings, not an `aliases` API identifier |
| `input mapping` | Surface-shaped input normalization into the same authored trail input contract |
| `facet` | Retired bare vocabulary; use `trailhead` for grouped surface entries or `schema facet` only as descriptive schema prose |
| `trailhead` | Prose/teaching word for a grouped surface entry — a list surface binding over existing trails, authored through `surfaceOverlay()` group bindings. Not a graph node, package category, or core `Facet` primitive |
| `schema facet` | Descriptive phrase for a schema-owned slice or view when docs need it; not a decided public API |
| `trail fork` | Doctrine phrase for the point where a surface accommodation would change semantics or merge or hide member identity; author a distinct trail, composing trail, or trailhead that preserves identity instead |
| `MCP resources` | MCP protocol resources used for cold context; not Trails `resource()` infrastructure declarations |
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
| `trailhead()` | Historical boundary API retired in favor of `surface()`. Use `trailhead` as prose only, for a grouped surface entry (a list surface binding) over existing trails. |
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
2. `implementation:` — establish how the trail runs
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

- Lead with code: `trail()` → `implementation:` → `topo()` → `surface()`
- Use the lexicon consistently: "compose" instead of "cross," "surface"
  instead of generic transport vocabulary
- Keep the metaphor disciplined. The words should clarify behavior, not turn the docs into theme writing.
- Prefer the lexicon's nouns even for internal architecture explanations. Leaving generic words in place only creates translation tax later.
- Use `implementation` for the authored behavior field, while keeping `trail` as the runnable unit. A trail with an implementation is a runnable contract.
