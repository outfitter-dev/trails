---
id: 24
slug: typed-trail-composition
title: Typed Trail Composition
status: accepted
created: 2026-04-09
updated: 2026-05-26
owners: ['[galligan](https://github.com/galligan)']
depends_on: [3, 7]
---

# ADR-0024: Typed Trail Composition

## Context

### Composition works but types don't follow

ADR-0003[^1] unified trail and hike into a single primitive. Every trail can declare `composes` and call `ctx.compose()`. The warden verifies that declarations match usage. The mechanism is solid — but the types aren't.

Today, `ctx.compose()` returns `Result<unknown, TrailsError>`. The caller gets a Result, but the success payload is untyped. In the Stash dogfood app (19 trails, 68 tests), every composite trail had `as` casts on compose results:

```typescript
// Today: compose returns Result<unknown, TrailsError>
const result = await ctx.compose('gist.show', { id: input.id });
if (result.isOk()) {
  const gist = result.value as { id: string; description: string; content: string };
  // ...
}
```

The `as` cast is a type hole. The compiler can't verify that `gist.show` actually returns that shape. If the composed trail's output schema changes, the caller's cast silently lies. This is exactly the kind of drift the framework is designed to prevent.

### Composition-only input has no home

The same dogfood app surfaced a second gap. `gist.fork` needs to tell `gist.create` where the fork came from — a `forkedFrom` field that only makes sense when one trail composes another. Today, that field has to go on the public input schema:

```typescript
trail('gist.create', {
  input: z.object({
    description: z.string(),
    content: z.string(),
    forkedFrom: z.string().optional(),  // leaked to CLI, MCP, HTTP
  }),
  // ...
});
```

Now `--forked-from` appears as a CLI flag. The MCP tool description includes it. The HTTP request body accepts it. A field that exists solely for internal composition pollutes every public surface. The developer can't express "this input is for composition only."

An early proposal suggested an opaque `composeMeta: Record<string, unknown>` bag on `ctx.compose()`. This was rejected — an untyped hidden channel violates "derive, don't hide." If it carries data, it needs a schema. If it has a schema, it's governable.

## Decision

### Typed `ctx.compose()` via trail object passing

`ctx.compose()` accepts either a string ID (existing behavior, untyped) or a trail definition object (new, fully typed):

```typescript
import { showGist } from '../gist/show';

trail('gist.fork', {
  composes: [showGist, createGist],
  blaze: async (input, ctx) => {
    // Typed: result is Result<GistShowOutput, TrailsError>
    const result = await ctx.compose(showGist, { id: input.id });

    if (result.isErr()) return result;

    // result.value is fully typed — no cast needed
    const gist = result.value;
    // ...
  },
});
```

When you pass the trail object, TypeScript infers the input and output types from the trail's schemas. The compiler catches mismatched inputs and incorrect assumptions about the output shape. When the composed trail's schema changes, the caller gets a compile error, not a silent drift.

The string-based form remains as an escape hatch for dynamic dispatch or late-bound resolution:

```typescript
// Untyped escape hatch — returns Result<unknown, TrailsError>
const result = await ctx.compose('gist.show', { id: input.id });
```

The warden can suggest the typed form when it detects `as` casts on compose results — the same way it already flags `composes` / `ctx.compose()` mismatches.

### `composes` accepts trail objects

The `composes` declaration already accepts string IDs. It now also accepts trail definition objects, and can mix both:

```typescript
trail('gist.fork', {
  composes: [showGist, createGist],     // trail objects — typed
  // or
  composes: ['gist.show', createGist],  // mixed — string is untyped
  // ...
});
```

When `composes` contains trail objects, the warden can verify that `ctx.compose()` calls use matching objects, not just matching string IDs. The resolution is tighter: the object IS the trail, not a string that must be looked up.

### `composeInput` is a typed composition-only schema

A new optional field on the trail spec. It declares input that is only available through `ctx.compose()`, invisible to public surfaces:

```typescript
trail('gist.create', {
  input: z.object({
    description: z.string(),
    content: z.string(),
  }),
  composeInput: z.object({
    forkedFrom: z.string().optional(),
  }),
  blaze: async (input, ctx) => {
    // input has both: public input + composeInput, merged
    if (input.forkedFrom) {
      // record the fork relationship
    }
    // ...
  },
});
```

**What the surfaces see:**

- **CLI** derives flags from `input` only. No `--forked-from` flag.
- **MCP** describes tool parameters from `input` only. No `forkedFrom` in the tool schema.
- **HTTP** accepts request body fields from `input` only. No `forkedFrom` in the OpenAPI spec.

**What `ctx.compose()` sees:**

When composing a trail that declares `composeInput`, the caller passes both schemas merged. TypeScript enforces the combined type:

```typescript
// The caller sees input + composeInput as the expected shape
await ctx.compose(createGist, {
  description: 'Forked gist',
  content: originalGist.content,
  forkedFrom: originalGist.id,  // typed, required by composeInput
});
```

If `composeInput` declares a required field and the caller omits it, the compiler catches it. If the caller passes a field that doesn't exist in either schema, the compiler catches that too.

### `composeInput` is a new information category

In the information architecture[^2], `composeInput` is **authored** — the developer declares it. Its visibility is **composition-scoped** — it exists between trails, not between trails and the outside world.

This is a new scope, but not a new mechanism. The framework already handles `input` (public-scoped) and derives surface representations from it. `composeInput` is the same pattern with a narrower scope: derive nothing for public surfaces, merge into the compose contract.

### The blaze receives the merged input

The blaze receives a single `input` parameter that merges `input` and `composeInput`. The developer doesn't handle two separate objects:

```typescript
blaze: async (input, ctx) => {
  // input.description — from public input
  // input.forkedFrom  — from composeInput (undefined when called from surface)
}
```

When invoked via a public surface, `composeInput` fields are `undefined` (or absent, depending on schema optionality). When invoked via `ctx.compose()`, they're present if the caller provided them.

This means `composeInput` fields should generally be optional — the trail must handle both the public case (no compose input) and the composition case (compose input provided). A required `composeInput` field means the trail can ONLY be invoked via `ctx.compose()`, never from a public surface. The warden can flag this and suggest adding `visibility: 'internal'`[^3] for consistency.

### Warden rules

Two new rules extend the existing `composes-declarations` rule:

| Rule | Severity | Description |
|---|---|---|
| `typed-compose-preferred` | suggestion | `ctx.compose()` called with string ID when the trail object is available in scope. Suggests the typed form. |
| `compose-input-visibility` | warning | Trail has required `composeInput` fields but `visibility: 'public'`. Suggests `visibility: 'internal'`. |

The existing `composes-declarations` rule gains awareness of `composeInput`: if a `ctx.compose()` call passes fields that exist in the target's `composeInput` but not its `input`, the warden confirms the match rather than flagging unknown fields.

## Non-goals

- **Topo-aware type inference from string IDs.** Making `ctx.compose('gist.show', input)` infer types from the string alone would require the topo graph to be a type-level construct. This is architecturally interesting but significantly more complex. The trail-object approach gives us full type inference without type-level topo resolution.
- **Runtime enforcement of `composeInput` isolation.** The framework doesn't prevent a public surface from passing `composeInput` fields at runtime — the fields are simply not derived into the surface's parameter schema. A hand-crafted HTTP request could include them. This is acceptable: the contract is the schema, not runtime policing.
- **`composeOutput` — composition-only output.** A trail that returns different shapes depending on whether it's called from a surface or via `ctx.compose()`. This introduces divergence in the output contract and is not proposed here.

## Consequences

### Positive

- **Composition is type-safe.** `ctx.compose(showGist, input)` gives `Result<GistShowOutput, TrailsError>`. No casts, no drift, compiler-verified.
- **Composition-only input is governable.** `composeInput` is a typed schema, not a hidden bag. The warden can verify compose contracts the same way it verifies public input contracts.
- **Public surfaces stay clean.** Fields like `forkedFrom` never appear in CLI flags, MCP tool descriptions, or HTTP parameters. The public contract reflects what public consumers need.
- **Progressive adoption.** Existing `ctx.compose('id', input)` with string IDs continues to work. The typed form is an upgrade, not a migration.

### Tradeoffs

- **Import dependency.** Typed composition requires importing the trail definition object. String-based composition only needs the ID. This creates a source-level dependency between trail files. The tradeoff is worth it: the dependency is real (the trails ARE coupled), and making it visible is better than hiding it behind a string.
- **`composeInput` adds a field to the trail spec.** One more thing to learn. The justification: without it, the only option is polluting public schemas with composition-only fields, which is worse.
- **Merged input ambiguity.** The blaze receives one merged object. A developer reading the blaze doesn't immediately see which fields are public vs composition-only without checking the spec. The type system distinguishes them, but the runtime object doesn't carry provenance.

## Non-decisions

- **Parallel composition with typed results.** ADR-0003 deferred parallel `ctx.compose()`. When that lands, the typed form should support it (`ctx.composeAll([trailA, inputA], [trailB, inputB])` with tuple-typed results). Design deferred.
- **`composeInput` and contours.** How `composeInput` interacts with `deriveTrail()` — e.g., a CRUD factory that auto-generates `composeInput` for `create` trails with `forkedFrom` or `clonedFrom` fields. Depends on contour integration with trail factories.
- **Compose contract evolution.** How `composeInput` changes interact with versioning. If a trail adds a required `composeInput` field, all callers must update. The versioning ADR should address compose-contract compatibility.

## References

- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md) — the unified trail/hike primitive with `composes` and `ctx.compose()`
- [ADR-0007: Governance as Trails](0007-governance-as-trails.md) — the warden's `composes-declarations` rule that this extends
- [ADR-0000: Core Premise — The information architecture](0000-core-premise.md) — the authored/projected/enforced categories that `composeInput` extends with composition scope
- [ADR-0030: Contours as First-Class Domain Objects](0030-contours-as-first-class-domain-objects.md) — contour-aware `deriveTrail()` that may auto-generate `composeInput`
- [Tenets: One schema, one Result, one error taxonomy](../tenets.md) — `composeInput` preserves the "one schema" principle by scoping rather than splitting

[^1]: [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md) — `composes` and `ctx.compose()` as the composition mechanism
[^2]: [ADR-0000: Core Premise — The information architecture](0000-core-premise.md)
[^3]: See [ADR-0027: Trail Visibility and Surface Filtering](0027-visibility-and-filtering.md)
