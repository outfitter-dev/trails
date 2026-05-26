---
id: 3
slug: unified-trail-primitive
title: Unified Trail Primitive
status: accepted
created: 2026-03-29
updated: 2026-05-26
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0003: Unified Trail Primitive

## Context

### The two-primitive era

Early versions of Trails had two definition primitives: `trail()` for simple operations and `hike()` for composite ones that compose other trails. On paper, the distinction made sense — a hike coordinates multiple trails, so it felt like a different concept. In practice, the split created problems that outweighed the semantic clarity.

### What the split actually cost

The `trail` / `hike` distinction rippled through the entire system:

- **Topo had two maps.** `topo.trails` and `topo.hikes`, each with its own lookup, iteration, and registration logic. Every function that operated on "everything in the topo" needed to handle both.
- **Kind discriminant everywhere.** `kind: 'trail'` vs `kind: 'hike'` appeared in types, runtime checks, surface connectors, test helpers, and governance rules. Each was a branch point where code had to ask "which one am I dealing with?"
- **Surface connectors doubled their code paths.** CLI, MCP, and every future surface needed separate handling for trails and hikes. The logic was nearly identical — the only meaningful difference was whether `composes` was present.
- **Testing split in two.** `testTrail` and `testHike` were separate functions. `TrailScenario` and `HikeScenario` were separate types. The warden had separate rules for each. All of this for a distinction that boiled down to: does the spec have a non-empty `composes` array?
- **Cognitive overhead.** New contributors had to learn when to use `trail()` vs `hike()`. The answer was always the same — "use `hike()` if you call `ctx.compose()`" — but the question kept coming up because the distinction felt like it should mean more than it did.

### The realization

A hike was a trail with a non-empty `composes` array. That's it. The input schema, output schema, error taxonomy, examples, meta, intent, implementation signature — all identical. The two primitives existed because composition *felt* like a different category, not because it *was* one structurally.

When a conceptual distinction doesn't produce a structural difference, the abstraction is wrong.

## Decision

### One primitive: `trail()`

There is one definition function: `trail()`. Composition is a property of a trail, not a different kind of thing.

```typescript
// Simple trail — no composes
const greet = trail({
  id: 'greet',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  blaze: async (input) => Result.ok({ message: `Hello, ${input.name}` }),
});

// Composing trail — declares composes, uses ctx.compose()
const onboard = trail({
  id: 'onboard',
  input: z.object({ userId: z.string() }),
  output: z.object({ status: z.string() }),
  composes: ['users.create', 'notify.welcome'],
  blaze: async (input, ctx) => {
    const user = await ctx.compose('users.create', { id: input.userId });
    if (user.isErr()) return user;
    await ctx.compose('notify.welcome', { userId: input.userId });
    return Result.ok({ status: 'onboarded' });
  },
});
```

### `composes` is always present

On the frozen Trail object, `composes` defaults to `[]`. Every trail has it. Most don't use it. This means no runtime type narrowing, no discriminant checks, no conditional logic based on whether a trail composes.

### `ctx.compose()` is the composition mechanism

The execution context provides `ctx.compose()` at runtime. It resolves a trail by ID from the topo, validates the input, runs it, and returns the Result. The calling trail never imports or references the composed trail directly — it uses the ID declared in its `composes` array.

### The warden enforces alignment

The `composes-declarations` rule validates that every `ctx.compose('some.trail')` call in an implementation has a corresponding entry in the trail's `composes` array. If you call a trail you didn't declare, the warden catches it. If you declare a trail you never call, the warden catches that too.

This is the drift guard for composition. The `composes` array is the declaration. The `ctx.compose()` calls are the reality. The warden keeps them aligned.

### `kind` is always `'trail'`

No discriminant. No branching. One type, one code path, everywhere.

### What was removed

- `hike()` — the separate "composition-only" primitive. Trails handle both direct execution and compositions.
- `topo.hikes` — gone; `topo.trails` is the single map
- `kind: 'hike'` — gone; `kind` is always `'trail'`

## Consequences

### Positive

- **One topo map.** Every function that operates on the topology iterates one collection. No "and also check hikes" logic anywhere.
- **One code path per surface.** CLI, MCP, HTTP — each handles one kind of thing. The connector code is half what it was.
- **Simpler testing.** `testTrail` handles everything, including composition chains. `testComposes` exists for focused composition testing, not because the framework forced a different type.
- **Composition is a property, not a type.** A trail that starts simple can add `composes` later without changing its definition function, its tests, or its surface wiring. The progression is smooth.
- **Fewer concepts to learn.** One primitive. One type. Composition is opt-in via a field, not a fork in the road.

### Tradeoffs

- **`composes: []` on every trail.** Simple trails carry an empty array they never use. The cost is negligible — an empty frozen array — but it's technically unnecessary data on trails that don't compose.
- **Less explicit at the call site.** `trail()` doesn't tell you at a glance whether composition is involved. You have to look at the spec. In practice, the `composes` field is visible in the definition, and the warden reports composition graphs via `survey`.

### What this does NOT decide

- Whether `composes` will support conditional or dynamic composition (e.g., "compose trail A if condition X, trail B otherwise"). Currently, `composes` is a static array of trail IDs.
- Whether composition chains will support parallel execution. Currently, `ctx.compose()` calls are sequential.
- How deeply nested composition chains should be governed. The warden validates one level; deeper governance is future work.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — the foundational decisions, particularly "the trail is the product" and "derive by default"
- [ADR-0001: Naming Conventions](0001-naming-conventions.md) — bare nouns for definitions and the vocabulary progression informed the single-primitive approach
