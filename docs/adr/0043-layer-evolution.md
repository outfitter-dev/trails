---
id: 43
slug: layer-evolution
title: Layer Evolution
status: accepted
created: 2026-04-09
updated: 2026-05-04
accepted: 2026-05-03
amended: 2026-05-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [6, 12]
---

# ADR-0043: Layer Evolution

## Amendment 2026-05-04

The original accepted text introduced a second bare wrapper primitive named `Middleware` and a new `executeTrail({ middleware })` option. That split was withdrawn before public propagation. Trails now keeps two mechanisms, not three:

1. Pipeline stages for universal framework concerns such as permit enforcement and execution recording.
2. Typed `Layer` for authored cross-cutting behavior. Layers may declare `input` for surface projection, or omit `input` to remain surface-invisible wrappers.

A bare function wrapper can be reconsidered only if future evidence satisfies four conditions: it is structurally necessary, its bareness is desirable rather than merely convenient, downstream users can understand the distinction from `Layer`, and real use cases have exhausted the layer-without-input shape.

## Context

### Layers sat outside the governance loop

Every other concept in Trails participates in a feedback cycle: author a declaration, derive behavior, validate with the warden, report with survey, test with examples. Layers didn't. They were opaque functions passed to blaze options, invisible to every feedback system the framework provides.

ADR-0006[^1] established the shared execution pipeline. Step 3 was "compose layers" — wrap the implementation with any layers passed via `options.layers`. The mechanism worked, but the layers themselves were black boxes. The warden couldn't inspect them. Survey couldn't report them. Schema diffing couldn't detect when a layer added or removed a field. Layers were the one execution-time concern that escaped governance.

### Framework concerns were dressed as user configuration

The four layers shipped before this work broke down as follows:

| Layer | What it actually is | Derivable? |
| --- | --- | --- |
| `authLayer` | Pipeline enforcement of `trail.permit` | Yes — from `permit` declaration |
| `tracingLayer` | Always-on execution recording | Yes — from pipeline position |
| `autoIterateLayer` | CLI-specific pagination behavior | Yes — from output schema shape |
| `dateShortcutsLayer` | CLI-specific date expansion | Yes — from input schema shape |

The `tracingLayer` row was resolved by [ADR-0041: Unified Observability](0041-unified-observability.md): tracing is core execution-pipeline behavior, not an authored layer.

None were genuinely authored cross-cutting concerns. All four were either derivable from trail declarations or intrinsic pipeline behavior. To get basic framework capabilities (auth, recording), the developer imported layers, created instances, and passed them to every `executeTrail` call. That was requiring Level 2 ceremony for Level 0 behavior — the same anti-pattern as if input validation were a layer you had to import and wire.

### The layer ordering bug was a design smell

`executeTrail(t, input, { layers: [authLayer, tracingLayer] })` silently put auth inside tracing, meaning auth failures weren't recorded. Reversing the order meant tracing didn't capture the full execution envelope. This wasn't a configuration problem. It was a symptom of framework concerns living in the wrong abstraction. With auth and recording as pipeline stages with fixed ordering, the bug is structurally impossible.

### Layers needed input schemas

Layers that add surface-visible behavior (dry-run, pagination, verbose mode) needed to declare the inputs they require. Before this work, if a dry-run layer needed a `--dry-run` flag, that flag had to be manually added to each trail's input schema or wired per-command in the surface. The layer knew what it needed. The framework should derive the surface representation.

### Three forcing features lined up

1. **Permits** (ADR-0012[^2]) introduced auth enforcement. Shipping an `authLayer` would mean shipping a pattern we'd later deprecate.
2. **Tracing** (ADR-0013) introduced execution recording. A `tracingLayer` would repeat the same mistake.
3. **Packs** need to carry execution behavior. If a pack's trails declare `permit`, enforcement should follow automatically. If layers were the mechanism, packs carried layers. With the pipeline deriving enforcement from declarations, packs carry nothing extra.

The window to get this right was before permits shipped as a layer export.

## Decision

Layers dissolved into two distinct mechanisms: **pipeline stages** for universal framework concerns and **typed layers with optional input schemas** for authored cross-cutting behavior.

The work shipped across [TRL-471] through [TRL-477]:

- [TRL-471] — typed `Layer` interface with optional `input` and canonical `executeTrail({ layers })` support.
- [TRL-472] — three attachment scopes (trail, surface, topo) and the topo → surface → trail → blaze composition order.
- [TRL-473] — CLI flag projection from layer `input` schemas.
- [TRL-474] — MCP and HTTP projection from layer `input` schemas.
- [TRL-475] — removal of `authLayer` from `@ontrails/permits` (pipeline-enforced).
- [TRL-476] — removal of `autoIterateLayer` and `dateShortcutsLayer` from `@ontrails/cli` (surface-derived).
- [TRL-477] — this ADR's promotion and the migration guide.

### Pipeline stages replaced framework layers

Auth enforcement and execution recording became fixed stages in `executeTrail`, derived from trail declarations. The developer doesn't import, configure, or wire them.

The pipeline as it ships:

```text
executeTrail(trail, rawInput, options?)
  1. Validate input
  2. Resolve context (includes permit resolution)
  3. Enforce permit (pipeline stage; derived from trail.permit)
  4. Compose layers (scoped to authored concerns only)
  5. Run implementation
  6. Catch unexpected throws
  7. Record execution (pipeline stage; derived from trail properties + tracing config)
  8. Emit lifecycle events (trail.completed / trail.failed)
```

Steps 3, 7, and 8 are pipeline stages that replaced framework layers. Step 4 is scoped to authored concerns only.

**Permit enforcement is a pipeline stage.** The pipeline reads `trail.permit`. When defined, it checks `ctx.permit` against declared scopes. On failure, it returns `Result.err(PermitError)` before the implementation runs. A trail with `permit: { scopes: ['billing:write'] }` is protected on every surface automatically. A surface that forgets to configure auth doesn't silently leave trails unprotected.

**Recording is a pipeline stage.** The pipeline always records. In development, the default sink writes to the local dev store with 100% sampling. In production, the sink is configured at bootstrap. Sampling policy is derived from trail properties: mutations default to 100%, reads to a configured rate. Per-trail overrides are declarations on the trail spec, not wrapper configuration.

**Layers compose inside the auth/record envelope:**

```text
auth check -> layer chain -> implementation -> recording
```

Layers can trust that `ctx.permit` is populated. Layer rejections are always recorded. The ordering bug is structurally impossible.

### Layers carry declared input schemas

The shipped `Layer` interface (in `@ontrails/core`):

```typescript
export interface Layer {
  readonly name: string;
  readonly description?: string | undefined;
  readonly input?: z.ZodType<unknown> | undefined;
  wrap<I, O>(
    trail: AnyTrail,
    implementation: Implementation<I, O>,
  ): Implementation<I, O>;
}
```

A layer's `input` field is an optional Zod schema declaring what the layer needs from the invoking surface. Layers without `input` behave as plain wrappers; layers with `input` get schema projection on every surface.

```typescript
const dryRun: Layer = {
  name: 'dry-run',
  input: z.object({
    dryRun: z.boolean().default(false).describe('Preview without executing'),
  }),
  wrap: (trail, blaze) => async (input, ctx) => {
    if ((input as { dryRun?: boolean }).dryRun) {
      return Result.ok({ preview: true, wouldExecute: trail.id });
    }
    return blaze(input, ctx);
  },
};
```

The layer declares what it needs. The framework handles the rest.

### Surface projection of layer inputs

Each surface projects layer inputs the same way it projects trail inputs — derived from the schema, rendered in the surface's native idiom:

| Surface | Projection | Reference |
| --- | --- | --- |
| CLI | `--dry-run` flag on every command using this layer | [TRL-473] |
| MCP | `dryRun` boolean parameter on every tool using this layer | [TRL-474] |
| HTTP | `?dryRun=true` query for reads, request body for writes | [TRL-474] |

A trail's full resolved input surface is a composition:

```text
trail's own input (from contour, between, or explicit schema)
+ layer inputs (from every layer applied to the trail)
= the resolved input the surface projects
```

The trail doesn't restate layer inputs. The surface doesn't manually wire them. The framework composes them.

### Flat merge with collision rename

Layer inputs and trail inputs merge into a single flat object. In practice, collisions are rare — layer inputs use operational names (`dryRun`, `page`, `limit`, `verbose`) while trail inputs use domain names (`gistId`, `description`, `status`).

When a layer field collides with a trail input field, the field is projected as `<layerName>-<originalField>` and a one-shot stderr warning is emitted. This keeps the surface unambiguous without hard-failing during migration. The warden flags persistent collisions as authored errors.

Why flat over nested: CLI projection. `--dry-run` is natural. `--layer-dry-run-dry-run` is not. MCP and HTTP also benefit from flat surfaces.

### The blaze receives only trail input

The layer intercepts its own fields before the blaze runs. The blaze function receives only the trail's input, typed against the trail's input schema:

```typescript
// dryRun layer receives { ...trailInput, dryRun: true }
// If dryRun is true, layer intercepts and returns early.
// If dryRun is false, layer strips dryRun and passes trailInput to blaze.
// Blaze receives { gistId: '123', description: 'Hello' } — no dryRun field.
```

Layers are transparent to the blaze. The blaze doesn't know they exist.

### Three attachment scopes

Where you attach a layer determines its scope ([TRL-472]):

**Trail level.** Applies to one trail on every surface. These layers are about what the trail *does*.

```typescript
trail('gist.create', {
  contours: [gist],
  pattern: 'crud.create',
  layers: [dryRun, audit],
  blaze: async (input, ctx) => { /* ... */ },
});
```

Use cases: dry-run, rate limiting, audit logging, retry behavior.

**Surface level.** Applies to all trails on one specific surface. These layers are about how the surface *works*.

```typescript
surface(app, {
  cli: { layers: [verbose, outputFormat] },
  mcp: { layers: [progress] },
  http: { layers: [cors, compression] },
});
```

`verbose` adds `--verbose` to every CLI command but doesn't appear on MCP tools. `progress` adds progress reporting to every MCP tool but doesn't affect CLI. The layer's input projects only onto the surface where it's declared.

Use cases: output format, verbose/quiet mode, pagination style (CLI), progress reporting (MCP), CORS, compression (HTTP).

**Topo level.** Genuinely universal. Applies to every trail on every surface.

```typescript
const app = topo('myapp', { trails }, {
  layers: [telemetry],
});
```

Use cases: telemetry, request ID injection.

| Level | Scope | Attachment point | Example |
| --- | --- | --- | --- |
| Trail | One trail, all surfaces | `trail({ layers: [...] })` | dry-run, audit |
| Surface | All trails, one surface | `surface(app, { cli: { layers: [...] } })` | verbose, output format |
| Topo | All trails, all surfaces | `topo(name, { trails }, { layers: [...] })` | telemetry |

The layer itself doesn't declare which surface it's for. *Where you attach it* determines scope. Same layer, different attachment points, different reach.

### Resolution order

When a trail executes, the full layer stack is composed:

```text
topo layers -> surface layers -> trail layers -> blaze
```

Topo layers run first (outermost), then surface layers, then trail-specific layers, then the blaze function. Broader layers wrap narrower layers. Within a level, the developer controls order.

### Surface derivation absorbed CLI-specific layers

`autoIterateLayer` and `dateShortcutsLayer` were schema-derived surface behavior. They didn't wrap execution — they augmented the CLI surface based on schema shape. The CLI surface now absorbs them as built-in derivations ([TRL-476]):

| Trail property | Derived CLI behavior | Override |
| --- | --- | --- |
| `output` schema shape (paginated) | `--all` flag, auto-iteration | `surface: { cli: { autoIterate: false } }` |
| `input` schema shape (date range) | Date shortcut expansion | `surface: { cli: { dateShortcuts: false } }` |
| `intent: 'destroy'` | `--dry-run` flag, confirmation prompt | `surface: { cli: { dryRun: false } }` |

These behaviors are on by default.

### Layer without `input` is the escape hatch

For genuinely authored cross-cutting concerns the framework cannot derive, use a `Layer` without an `input` schema:

```typescript
const tenantGuard: Layer = {
  name: 'tenant-guard',
  wrap: (_trail, impl) => async (input, ctx) => {
    if (ctx.permit?.tenantId !== (input as { tenantId?: string }).tenantId) {
      return Result.err(new PermitError('tenant mismatch'));
    }
    return impl(input, ctx);
  },
};

await executeTrail(trail, input, { layers: [tenantGuard] });
```

The layer has a name and a stable runtime shape, but it does not project fields onto surfaces. This absorbs the cases that were briefly assigned to `Middleware` while keeping the public model to one authored wrapper primitive.

### Warden coaching

One warden rule guards the migration ([TRL-476], [TRL-477]):

- `no-legacy-layer-imports` (error) — flags `import { authLayer } from '@ontrails/permits'`, `import { autoIterateLayer } from '@ontrails/cli'`, and `import { dateShortcutsLayer } from '@ontrails/cli'`. These exports no longer exist; the rule catches stale references in source.

### Progressive adoption model

**Level 0 — zero configuration.** `executeTrail(trail, input)` validates input, catches throws, enforces permits, records execution (dev sink), and surfaces (CLI/MCP/HTTP) derive their behavior from schemas. No layers. No presets.

**Level 1 — declarations compound.** Add `intent` and `permit` to a trail. Auth enforcement activates. Recording policy becomes intent-aware. Surfaces derive additional behavior. No new wiring.

**Level 2 — authored layers.** Attach typed layers at the trail, surface, topo, or execution-call level for cross-cutting behavior. Layers with input schemas project onto surfaces; layers without input schemas remain surface-invisible wrappers.

**Level 3 — override defaults.** Per-trail overrides for pipeline behavior (`tracks: { sample: 1.0 }`) or surface behavior (`surface: { cli: { autoIterate: false } }`). Declarations on the trail spec, visible to the warden.

## Non-goals

- **Bare-function escape hatch.** A separate `(impl) => impl` primitive was withdrawn in the 2026-05-04 amendment. Reintroduction requires evidence that it is structurally necessary, that bareness is desirable, that the distinction from `Layer` is legible downstream, and that real use cases have exhausted layers without `input`.
- **Layer input type access in wrap function.** Full generic type inference for the composed input (trail input + layer input) within the `wrap` function. The layer can type its own fields; the trail's input type is unknown at layer definition time. Addressed through runtime field stripping, not compile-time composition.
- **Feature-implied layers.** A `crud.list` feature automatically attaching a pagination layer. The implication mechanism and override/exclusion API are deferred until the contour and feature model stabilizes.

## Consequences

### Positive

- **Governance got stronger for free.** Pipeline stages are derived from declarations the warden already validates. `no-legacy-layer-imports` flags references to removed exports. Before this work, the warden couldn't see whether auth was configured because it was an opaque function in blaze options.
- **Concept count dropped.** Developers no longer need to understand layers as a framework concept to get auth, recording, and CLI-specific behavior. Those are pipeline stages and surface derivations. The `Layer` concept survives for authored cross-cutting behavior with optional input schemas.
- **Packs got simpler.** A pack carries trails, resources, and signals. When a trail declares `permit`, enforcement follows automatically in any app that composes the pack. No layer wiring. No "remember to add `authLayer`."
- **New surfaces get framework behavior automatically.** Auth enforcement, recording, input validation, and error wrapping work immediately for any new surface. The new surface only implements its own surface derivations.
- **Layer input schemas are projectable and diffable.** Adding a layer input is a surface change visible in the schema export and lockfile. Removing a required layer input is a breaking change caught by schema diffing.
- **Global flags fall out naturally.** `--verbose` and `--debug` across all CLI commands are surface-level layers with input schemas. No separate concept for global flags.

### Tradeoffs

- **Two mechanisms replace one.** Pipeline stages and typed layers are more precise than "layers handle everything." Most developers only encounter pipeline stages (Level 0) and never reach authored layers.
- **Vocabulary instability.** This primitive has been `layer`, then `gate` (beta.14), then briefly `Layer` plus `Middleware`. The `Middleware` split was withdrawn before public propagation. The migration guide is the durable countermeasure.
- **Flat merge limits namespace.** Layer inputs and trail inputs share a flat namespace. The collision-rename rule (`<layerName>-<originalField>`) prevents structural failure, but the warden must catch persistent collisions early. A future namespacing mechanism is possible but not proposed here.

### Risks

- **Pipeline stage ordering is framework-owned.** Developers cannot reorder auth relative to recording. This is intentional (it prevents the ordering bug), but it removes a degree of freedom. If a legitimate use case requires custom ordering, it is design feedback for the typed `Layer` model.
- **Surface derivation may over-derive.** Auto-detecting paginated output schemas and date range fields could produce false positives. The override mechanism (`autoIterate: false`, `dateShortcuts: false`) mitigates this, but the defaults must be conservative.

## Non-decisions

- **`resolvePermit` location.** Whether permit resolution lives on blaze options (per-surface, different extraction per transport) or on the topo (configure once). Settled with the permits implementation as blaze options because permit resolution is transport-specific (bearer token vs session vs keyring).
- **Tracing sampling configuration location.** Whether sampling policy lives on blaze options or app-level config. Settled with the tracing implementation as bootstrap configuration with per-trail overrides.
- **Per-trail surface override syntax.** The `surface: { cli: { autoIterate: false } }` field on trail specs is reserved in types but not documented further until demand materializes.
- **Layer ordering within a level.** If a trail has `layers: [dryRun, audit]`, the first wraps the second. Whether this is intuitive enough or needs explicit ordering declarations is deferred to implementation experience.
- **Lifecycle event ownership.** Whether `trail.completed` and `trail.failed` events are part of the signal system (registered in topo, subscribable) or a separate pipeline concern is decided alongside the signal implementation.

## References

- [ADR-0006: Shared Execution Pipeline with Result-Returning Builders](0006-shared-execution-pipeline.md) — the execution pipeline that layers compose into
- [ADR-0012: Connector-Agnostic Permits](0012-connector-agnostic-permits.md) — permit declarations that became pipeline-enforced
- [ADR-0013: Tracing — Runtime Recording Primitive](0013-tracing.md) — recording that became a pipeline stage
- [ADR-0041: Unified Observability](0041-unified-observability.md) — resolves the obsolete `tracingLayer` concept by moving tracing into core rather than preserving it as a layer
- [ADR-0004: Intent as a First-Class Property](0004-intent-as-first-class-property.md) — intent compounds with layers for surface derivation and governance
- [ADR-0024: Typed Trail Composition](0024-typed-trail-composition.md) — `crossInput` follows the same "compose schemas, project the union" pattern as layer input schemas
- [Layer Evolution Migration Guide](../migration/layer-evolution.md) — step-by-step migration for the removed exports and typed layer model
- [Tenets: One write, many reads](../tenets.md) — layer input schemas exemplify one authoring point feeding CLI flags, MCP parameters, HTTP query params, and lockfile diffing simultaneously

[^1]: [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) — `executeTrail` and the layer composition step.
[^2]: [ADR-0012: Connector-Agnostic Permits](0012-connector-agnostic-permits.md) — permit declarations now pipeline-enforced rather than layer-enforced.

[TRL-471]: https://linear.app/outfitter/issue/TRL-471
[TRL-472]: https://linear.app/outfitter/issue/TRL-472
[TRL-473]: https://linear.app/outfitter/issue/TRL-473
[TRL-474]: https://linear.app/outfitter/issue/TRL-474
[TRL-475]: https://linear.app/outfitter/issue/TRL-475
[TRL-476]: https://linear.app/outfitter/issue/TRL-476
[TRL-477]: https://linear.app/outfitter/issue/TRL-477
