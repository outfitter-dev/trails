---
slug: layer-evolution
title: Layer Evolution
status: draft
created: 2026-04-09
updated: 2026-05-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [6, 12]
---

# ADR: Layer Evolution

> Current v1 posture: this ADR remains a future-facing draft. The shipped API
> keeps `Layer` and `composeLayers()` as low-level execution plumbing passed
> through `run()` and surface options. Layers are not topo primitives, trail spec
> fields, or serialized graph nodes unless this evolution work is accepted and
> implemented.

## Context

### Layers sit outside the governance loop

Every other concept in Trails participates in a feedback cycle: author a declaration, derive behavior, validate with the warden, report with survey, test with examples. Layers don't. They're opaque functions passed to blaze options, invisible to every feedback system the framework provides.

ADR-0006[^1] established the shared execution pipeline. Step 3 is "compose layers" -- wrap the implementation with any layers passed via `options.layers`. The mechanism works, but the layers themselves are black boxes. The warden can't inspect them. Survey can't report them. Schema diffing can't detect when a layer adds or removes a field. Layers are the one execution-time concern that escapes governance.

### Framework concerns are dressed as user configuration

The five layers shipped today break down as follows:

| Layer | What it actually is | Derivable? |
| --- | --- | --- |
| `authLayer` | Pipeline enforcement of `trail.permit` | Yes -- from `permit` declaration |
| `tracingLayer` | Always-on execution recording | Yes -- from pipeline position |
| `configLayer` | Pass-through placeholder | N/A -- delete |
| `autoIterateLayer` | CLI-specific pagination behavior | Yes -- from output schema shape |
| `dateShortcutsLayer` | CLI-specific date expansion | Yes -- from input schema shape |

The `tracingLayer` row is resolved by [ADR-0041: Unified Observability](../0041-unified-observability.md): tracing is core execution-pipeline behavior, not an authored layer.

None are genuinely authored cross-cutting concerns. All five are either derivable from trail declarations or intrinsic pipeline behavior. To get basic framework capabilities (auth, recording), the developer imports layers, creates instances, and passes them to every `blaze()` call. That's requiring Level 2 ceremony for Level 0 behavior -- the same anti-pattern as if input validation were a layer you had to import and wire.

### The layer ordering bug is a design smell

`blaze(app, { layers: [authLayer, tracingLayer] })` silently puts auth inside tracing, meaning auth failures aren't recorded. Reversing the order means tracing doesn't capture the full execution envelope. This isn't a configuration problem. It's a symptom of framework concerns living in the wrong abstraction. When auth and recording are pipeline stages with fixed ordering, the bug is structurally impossible.

### Layers need input schemas

Layers that add surface-visible behavior (dry-run, pagination, verbose mode) need to declare the inputs they require. Today, if a dry-run layer needs a `--dry-run` flag, that flag must be manually added to each trail's input schema or wired per-command in the trailhead. The layer knows what it needs. The framework should derive the surface representation.

### Three upcoming features force a decision

1. **Permits** (ADR-0012[^2]) introduce auth enforcement. Shipping an `authLayer` means shipping a pattern we'd later deprecate.
2. **Tracing** (ADR-0013) introduces execution recording. A `tracingLayer` repeats the same mistake.
3. **Packs** need to carry execution behavior. If a pack's trails declare `permit`, enforcement should follow automatically. If layers are the mechanism, packs carry layers. If the pipeline derives enforcement from declarations, packs carry nothing extra.

The window to get this right is before permits ships as a layer export.

## Decision

Layers dissolve into three distinct mechanisms: **pipeline stages** for universal framework concerns, **typed layers with input schemas** for cross-cutting behavior that projects onto trailheads, and a **middleware escape hatch** for genuinely custom concerns the framework can't derive.

### Pipeline stages replace framework layers

Auth enforcement and execution recording become fixed stages in `executeTrail`, derived from trail declarations. The developer doesn't import, configure, or wire them.

The pipeline after this change:

```text
executeTrail(trail, rawInput, options?)
  1. Validate input (unchanged)
  2. Resolve context (unchanged, now includes permit resolution)
  3. Enforce permit (NEW: derived from trail.permit)
  4. Compose layers / middleware (scoped to authored concerns only)
  5. Run implementation
  6. Catch unexpected throws (unchanged)
  7. Record execution (NEW: derived from trail properties + tracing config)
  8. Emit lifecycle events (NEW: trail.completed / trail.failed)
```

Steps 3, 7, and 8 are new pipeline stages that replace framework layers. Step 4 is scoped to authored concerns only.

**Permit enforcement is a pipeline stage.** The pipeline reads `trail.permit`. When defined, it checks `ctx.permit` against declared scopes. On failure, it returns `Result.err(PermitError)` before the implementation runs. A trail with `permit: { scopes: ['billing:write'] }` is protected on every trailhead automatically. A trailhead that forgets to configure auth middleware doesn't silently leave trails unprotected.

**Recording is a pipeline stage.** The pipeline always records. In development, the default sink writes to the local dev store with 100% sampling. In production, the sink is configured at bootstrap. Sampling policy is derived from trail properties: mutations default to 100%, reads to a configured rate. Per-trail overrides are declarations on the trail spec, not middleware configuration.

**Middleware composes inside the auth/record envelope:**

```text
auth check -> layer/middleware chain -> implementation -> recording
```

Middleware can trust that `ctx.permit` is populated. Middleware rejections are always recorded. The ordering bug is structurally impossible.

### Layers gain declared input schemas

A layer gains an optional `input` property -- a Zod schema declaring what the layer needs from the trailhead surface:

```typescript
const dryRun = layer({
  id: 'dry-run',
  input: z.object({
    dryRun: z.boolean().default(false).describe('Preview without executing'),
  }),
  wrap: (trail, blaze) => async (input, ctx) => {
    if (input.dryRun) {
      return Result.ok({ preview: true, wouldExecute: trail.id });
    }
    return blaze(input, ctx);
  },
});

const pagination = layer({
  id: 'pagination',
  input: z.object({
    page: z.number().default(1),
    limit: z.number().default(20),
  }),
  wrap: (trail, blaze) => async (input, ctx) => {
    const result = await blaze(input, ctx);
    // wrap result with pagination metadata
    return result;
  },
});
```

The layer declares what it needs. The framework handles the rest.

### Trailhead projection of layer inputs

Each trailhead projects layer inputs the same way it projects trail inputs -- derived from the schema, rendered in the trailhead's native idiom:

| Trailhead | Projection |
| --- | --- |
| CLI | `--dry-run` flag on every command using this layer |
| MCP | `dryRun` boolean parameter on every tool using this layer |
| HTTP | `?dryRun=true` query param on every route using this layer |

A trail's full resolved input surface becomes a composition:

```text
trail's own input (from contour, between, or explicit schema)
+ layer inputs (from every layer applied to the trail)
= the resolved input the trailhead projects
```

The trail doesn't restate layer inputs. The trailhead doesn't manually wire them. The framework composes them.

### Flat merge, warden catches collisions

Layer inputs and trail inputs merge into a single flat object. In practice, collisions are rare -- layer inputs use operational names (`dryRun`, `page`, `limit`, `verbose`) while trail inputs use domain names (`gistId`, `description`, `status`). When collisions occur, the warden flags them as authored errors.

Why flat over nested: CLI projection. `--dry-run` is natural. `--layer-dry-run-dry-run` is not. MCP and HTTP also benefit from flat surfaces.

### The blaze receives only trail input

The layer intercepts its own fields before the blaze runs. The blaze function receives only the trail's input, typed against the trail's input schema:

```typescript
// dryRun layer receives { ...trailInput, dryRun: true }
// If dryRun is true, layer intercepts and returns early
// If dryRun is false, layer strips dryRun and passes trailInput to blaze
// Blaze receives { gistId: '123', description: 'Hello' } -- no dryRun field
```

Layers are transparent to the blaze. The blaze doesn't know they exist.

### Three attachment levels

Not all layers belong everywhere. Where you attach a layer determines its scope.

**Trail level.** Applies to one trail on every trailhead. These layers are about what the trail *does*.

```typescript
trail('gist.create', {
  contours: [gist],
  pattern: 'crud.create',
  layers: [dryRun, audit],
  blaze: async (input, ctx) => { /* ... */ },
});
```

Use cases: dry-run, rate limiting, audit logging, retry behavior.

**Trailhead level.** Applies to all trails on one specific trailhead. These layers are about how the trailhead *works*.

```typescript
trailhead(app, {
  cli: {
    layers: [verbose, outputFormat],
  },
  mcp: {
    layers: [progress],
  },
  http: {
    layers: [cors, compression],
  },
});
```

`verbose` adds `--verbose` to every CLI command but doesn't appear on MCP tools. `progress` adds progress reporting to every MCP tool but doesn't affect CLI. The layer's input projects only onto the trailhead where it's declared.

Use cases: output format, verbose/quiet mode, pagination style (CLI), progress reporting (MCP), CORS, compression (HTTP).

**Topo level.** Genuinely universal. Applies to every trail on every trailhead.

```typescript
const app = topo('myapp', trails, {
  layers: [telemetry],
});
```

Use cases: telemetry, request ID injection.

| Level | Scope | Attachment point | Example |
| --- | --- | --- | --- |
| Trail | One trail, all trailheads | `trail({ layers: [...] })` | dry-run, audit |
| Trailhead | All trails, one trailhead | `trailhead(app, { cli: { layers: [...] } })` | verbose, output format |
| Topo | All trails, all trailheads | `topo(name, trails, { layers: [...] })` | telemetry |

The layer itself doesn't declare which trailhead it's for. *Where you attach it* determines scope. Same layer, different attachment points, different reach.

### Resolution order

When a trail executes, the full layer stack is composed:

```text
topo layers -> trailhead layers -> trail layers -> blaze
```

Topo layers run first (outermost), then trailhead layers, then trail-specific layers, then the blaze function. Broader layers wrap narrower layers. Within a level, the developer controls order.

### Surface derivation absorbs CLI-specific layers

`autoIterateLayer` and `dateShortcutsLayer` are schema-derived surface behavior. They don't wrap execution -- they augment the CLI surface based on schema shape. After this change, the CLI surface absorbs them as built-in derivations:

| Trail property | Derived CLI behavior | Override |
| --- | --- | --- |
| `output` schema shape (paginated) | `--all` flag, auto-iteration | `autoIterate: false` |
| `input` schema shape (date range) | Date shortcut expansion | `dateShortcuts: false` |
| `intent: 'destroy'` | `--dry-run` flag, confirmation prompt | `dryRun: false` |

These behaviors are on by default. Override per-trail with `surface: { cli: { autoIterate: false } }` or per-trailhead on `blazeCli()` options.

### The middleware escape hatch

For genuinely authored cross-cutting concerns the framework can't derive, the `middleware` option on `blaze()` replaces the current `layers` option at the blaze level:

```typescript
blazeHttp(app, {
  middleware: [rateLimitMiddleware, auditLogMiddleware],
});
```

The interface stays minimal:

```typescript
export interface Middleware {
  readonly name: string;
  readonly description?: string;
  wrap<I, O>(trail: Trail<I, O>, impl: Implementation<I, O>): Implementation<I, O>;
}
```

Middleware is not a framework primitive. It has no `kind` discriminant, no factory function, no topo registration, no warden governance, no survey reporting. It's surface configuration -- the escape hatch for rate limiting, audit logging, tenant isolation, circuit breaking, and other concerns where the policy is genuinely new information the framework can't derive.

The name change from `layers` to `middleware` is intentional. `layers` implied framework-level composition. `middleware` communicates "custom execution wrapping" and is honest about being an escape hatch.

### Progressive adoption model

**Level 0 -- zero configuration.** `blaze(app)` validates input, catches throws, records execution (dev sink), and derives CLI/MCP/HTTP behavior from schemas. No layers. No presets. No imports beyond `trail`, `topo`, `blaze`.

**Level 1 -- declarations compound.** Add `intent` and `permit` to a trail. Auth enforcement activates. Recording policy becomes intent-aware. Surfaces derive additional behavior. No new wiring.

**Level 2 -- authored layers.** Attach typed layers at the trail, trailhead, or topo level for cross-cutting behavior with declared input schemas. The framework projects layer inputs onto trailhead surfaces.

**Level 3 -- middleware escape hatch.** Pass custom middleware to `blaze()` for genuinely novel concerns: rate limiting, tenant isolation, circuit breaking. Middleware runs inside the auth/record envelope.

**Level 4 -- override defaults.** Per-trail overrides for pipeline behavior (`tracks: { sample: 1.0 }`) or surface behavior (`surface: { cli: { autoIterate: false } }`). Declarations on the trail spec, visible to the warden.

## Non-goals

- **Governed middleware primitive.** Promoting `Middleware` to a first-class primitive with `kind`, topo registration, and warden governance. Zero surviving use cases inform the design of a governed middleware primitive today. If custom middleware proliferates and the governance gap hurts, that's the signal to promote -- with real instances to design from.
- **Layer input type access in wrap function.** Full generic type inference for the composed input (trail input + layer input) within the `wrap` function. The layer can type its own fields; the trail's input type is unknown at layer definition time. Addressed through runtime field stripping, not compile-time composition.
- **Feature-implied layers.** A `crud.list` feature automatically attaching a pagination layer. The implication mechanism and override/exclusion API are deferred until the contour and feature model stabilizes.

## Consequences

### Positive

- **Governance gets stronger for free.** Pipeline stages are derived from declarations the warden already validates. New rules become possible: "trail declares `permit` but no permit resolver is configured" (error), "trail declares `intent: 'destroy'` but has no `permit`" (coaching). Today, the warden can't see whether auth is configured because it's an opaque function in blaze options.
- **Concept count drops.** Developers no longer need to understand layers as a framework concept to get auth, recording, and CLI-specific behavior. Those are pipeline stages and surface derivations. The `layer` concept survives for authored cross-cutting behavior with input schemas. `middleware` appears only at the escape-hatch level.
- **Packs get simpler.** A pack carries trails, resources, and signals. When a trail declares `permit`, enforcement follows automatically in any app that composes the pack. No layer wiring. No "remember to add `authLayer`."
- **New trailheads get framework behavior automatically.** Auth enforcement, recording, input validation, and error wrapping work immediately for any new trailhead. The new trailhead only implements its own surface derivations.
- **Layer input schemas are projectable and diffable.** Adding a layer input is a surface change visible in the schema export and lockfile. Removing a required layer input is a breaking change caught by schema diffing.
- **Global flags fall out naturally.** `--verbose` and `--debug` across all CLI commands are trailhead-level layers with input schemas. No separate concept for global flags.

### Tradeoffs

- **Three mechanisms replace one.** Pipeline stages, typed layers, and middleware are more concepts than "layers handle everything." The tradeoff is precision: each mechanism handles its scope well, whereas layers were a vague catch-all. Most developers only encounter pipeline stages (Level 0) and never reach the others.
- **Vocabulary instability.** This primitive has been `layer`, then `gate` (beta.14), now `layer` again with `middleware` as the escape hatch. The name changes reflect genuine concept maturation, but they cost trust. Clear migration documentation is non-negotiable.
- **Flat merge limits namespace.** Layer inputs and trail inputs share a flat namespace. Operational names (`dryRun`, `page`) are unlikely to collide with domain names (`gistId`, `status`), but the warden must catch collisions early. A future namespacing mechanism is possible but not proposed here.

### Risks

- **Pipeline stage ordering is framework-owned.** Developers cannot reorder auth relative to recording. This is intentional (it prevents the ordering bug), but it removes a degree of freedom. If a legitimate use case requires custom ordering, the middleware escape hatch is the answer.
- **Surface derivation may over-derive.** Auto-detecting paginated output schemas and date range fields could produce false positives. The override mechanism (`autoIterate: false`, `dateShortcuts: false`) mitigates this, but the defaults must be conservative.

## Non-decisions

- **`resolvePermit` location.** Whether permit resolution lives on blaze options (per-trailhead, different extraction per transport) or on the topo (configure once). Leaning toward blaze options because permit resolution is transport-specific (bearer token vs session vs keyring). Decided with the permits implementation.
- **Tracing sampling configuration location.** Whether sampling policy lives on blaze options or app-level config. Sampling is probably deployment-specific (different in staging vs production). Decided with the tracing implementation.
- **Per-trail surface override syntax.** The `surface: { cli: { autoIterate: false } }` field on trail specs is reserved in types but not documented until demand materializes.
- **Layer ordering within a level.** If a trail has `layers: [dryRun, audit]`, the first wraps the second. Whether this is intuitive enough or needs explicit ordering declarations is deferred to implementation experience.
- **Lifecycle event ownership.** Whether `trail.completed` and `trail.failed` events are part of the signal system (registered in topo, subscribable) or a separate pipeline concern. Decided with the signal implementation.

## References

- [ADR-0006: Shared Execution Pipeline with Result-Returning Builders](../0006-shared-execution-pipeline.md) -- the execution pipeline that layers currently compose into
- [ADR-0012: Connector-Agnostic Permits](../0012-connector-agnostic-permits.md) -- permit declarations that become pipeline-enforced
- [ADR-0013: Tracing -- Runtime Recording Primitive](../0013-tracing.md) -- recording that becomes a pipeline stage
- [ADR-0041: Unified Observability](../0041-unified-observability.md) -- resolves the obsolete `tracingLayer` concept by moving tracing into core rather than preserving it as a layer
- [ADR-0004: Intent as a First-Class Property](../0004-intent-as-first-class-property.md) -- intent compounds with layers for surface derivation and governance
- [ADR-0024: Typed Trail Composition](../0024-typed-trail-composition.md) -- `crossInput` follows the same "compose schemas, project the union" pattern as layer input schemas
- [Tenets: One write, many reads](../../tenets.md) -- layer input schemas exemplify one authoring point feeding CLI flags, MCP parameters, HTTP query params, and lockfile diffing simultaneously

[^1]: [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) -- `executeTrail` and the current layer composition step
[^2]: [ADR-0012: Connector-Agnostic Permits](../0012-connector-agnostic-permits.md) -- permit declarations that should be pipeline-enforced, not layer-enforced
