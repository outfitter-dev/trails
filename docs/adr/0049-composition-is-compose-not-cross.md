---
id: 49
slug: composition-is-compose-not-cross
title: Composition is `compose`, not `cross`
status: accepted
created: 2026-05-25
updated: 2026-06-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [1, 3, 24, 28]
---

# ADR-0049: Composition is `compose`, not `cross`

## Context

### Where this came from

Radio fieldwork (2026-05-23) kept tripping on the same friction: every time a trail composed another, a reader — human or agent — had to stop and ask "wait, what's `cross`?" The concept underneath is composition: one trail invoking another through the framework's first-class compositional mechanism. That is not a concept Trails invented. It is a sixty-year-old idea with an established name. Filed as TRL-784.

### `cross` sits on the wrong side of the lexicon

ADR-0001 governs term choice with a brand-vs-plain heuristic: coin a naturalist term (`trail`, `blaze`, `topo`) only when the concept is genuinely new; use the standard term (`resource`, `signal`, `layer`, `Result`) when developers already know it. `cross` fails that test. It taxes every reader with a translation step for the life of the framework, to name something they already understand.

It also pictures the operation wrong. Real-world trails *cross* — they intersect at a point and continue separately. What the framework actually does is *embed* one trail's execution inside another's. That is composition, not intersection.

### Composition is structural, not call-and-forget

This is the deciding insight, and it is why the replacement is not `call`. In Trails, composition is not a transactional request that returns and vanishes. It is **structural and visible end to end**: a declared edge in the topo, a parent→child span in the trace, an intent that propagates and a permit scope that inherits. The contract is queryable precisely because these relationships are first-class.

`call` / `calls` would tell the wrong story — it connotes fire-a-request, get-a-response, relationship-gone. The `compose` family carries the right one: these trails are *pulled together* into a whole you can see through. That meaning is worth more than the marginal bare-invocation clarity `call` would buy.

## Decision

Retire `cross` / `crosses`. Adopt the `compose` family across the noun, the declaration, the runtime verb, the types, and the persistence layer.

```ts
// Before
export const reply = trail('reply', {
  crosses: ['readSessionContext', 'transmit'],
  blaze: async (input, ctx) => {
    const session = await ctx.cross(readSessionContext, { id: input.sessionId });
    // ...
  },
});

// After — reply is a composite trail
export const reply = trail('reply', {
  composes: ['readSessionContext', 'transmit'],
  blaze: async (input, ctx) => {
    const session = await ctx.compose(readSessionContext, { id: input.sessionId });
    // ...
  },
});
```

### The vocabulary

- **composite trail** — the noun. A trail built from other trails. Always qualified: `composite` is the adjective, never used bare (a bare "composite" is ambiguous — composite key? number? material?). It reads instantly because `trail` anchors the meaning, the way *internal trail* and *versioned trail* do.
- **`composes:`** — the declaration field on the trail spec. Replaces `crosses:`.
- **`ctx.compose(trail, input)`** — the runtime verb. Replaces `ctx.cross()`. Read it as "compose this trail *into* the composite" — each call weaves another strand into the whole.

### Why `compose`, not `call` or `run`

The replacement verb was explored in the open before this landed. `run` was rejected because it is already the **edge/direct** execution verb — `run()` and `trails run <id>` mean "execute a specific trail directly" (ADR-0001). Unifying inward onto `run` would conflate fresh edge execution with a context-bound child invocation, eroding a distinction the framework relies on.

`call` was the interim pick for raw invocation clarity, then reversed. The accretive reading of `compose` — "compose X *into* the composite" — dissolves the "compose one thing reads off" worry, and it carries the nested-invocation/inherits-context semantics *better* than `call`: composing X into a composite inherently means X is part of this trail's execution. Going full `compose` family also yields a single root across noun, declaration, verb, and types — maximum cohesion, one word to learn instead of a structure/action split.

### The type family

All compose-root, for cohesion:

| Before | After |
|---|---|
| `CrossFn` | `ComposeFn` |
| `CrossOptions` | `ComposeOptions` |
| `CrossBatchCall` / `CrossBatchOptions` / `CrossBatchResult(s)` | `ComposeBatch*` |
| `CrossInput<T>` | `ComposeInput<T>` |
| `crossInput` (field) | `composeInput` |

There is **no free-standing `cross()` export** — `ctx.cross` is the only runtime call surface — so the runtime rename is contained to the context method.

### Warden

`cross-declarations` → `composes-declarations`; `version-pinned-cross` → `version-pinned-compose`; the destructured-`cross` rule (`no-destructured-cross`) becomes the destructured-`compose` rule. `no-direct-implementation-call` keeps its name (it names the `.blaze()` anti-pattern, not the verb) — only its diagnostic text flips to `ctx.compose`.

### The serialized key migrates

`crosses` is persisted, not just a source symbol: a SQLite `topo_crossings` table and a `crosses` JSON key on `TopoGraphEntry` in `.trails/topo.lock`. We **rename the serialized key and migrate** — rather than keep a stable serialized key behind a renamed authored field — because the migration pattern is already established and low-risk (the store renamed columns this exact way at schema v12), and a stable key would leave a permanent `cross`/`compose` mismatch in the persistence layer, reintroducing the translation tax we are removing.

## Scope

A staged cutover, sized for reviewable PRs. The exhaustive file:line census lives on TRL-784[^trl784]; the stages:

- **Core API + types** — `crosses:`/`ctx.cross`, the type family, file renames (`cross-batch.ts`, `cross-schema.ts`, `testing/crosses.ts`), and the runtime string-literal matchers that must flip in lockstep (not blind find-replace): the recognition guards in `implementation-returns-result.ts`, `cross-declarations.ts`, `trail-versioning-source.ts`, the `ForkCtxResetKey` union in `fork-ctx.ts`, and the `'crosses'` literal in `versioning.ts`.
- **Persistence migration** — rename `topo_crossings` (schema bump + a `renameTableIfNeeded` helper), rename the `crosses` JSON key, bump the topo-graph schema version to force lockfile regen.
- **Warden** — rule renames + recognition matchers; regenerate the warden guide and the AGENTS.md generated block.
- **Docs/lexicon/tenets** — eleven active-facing files, plus a `cross`/`crosses` entry in the retired-terms treatment and a `docs/migration/cross-to-compose.md` guide.
- **Scaffold** — the `entity` starter, `create.ts` (and drop its destructured `const { cross } = ctx` per the OD-4 decision), and the `add.*` trails, so generated projects emit `composes:`/`ctx.compose`.
- **Codemod + Radio** — extend `scripts/vocab-cutover-rewrite.ts` (it already carries the prior `follow`→`cross` rename rules) and migrate Radio, the only consumer.

## Sequencing and dependencies

This cutover **must not start** until two things land:

- **The Warden-as-Coach stack** (TRL-785/786/791). Their recognition code keys on the literal string `'cross'`; TRL-791 adds a destructured-`cross` coaching rule. Renaming before they merge would thrash freshly-merged code, and the rename turns that rule into a destructured-`compose` rule.
- **TRL-783** (`ctx.cross` typed-optional fix). Land its typing fix on `cross` first, or fold it into this cutover — they touch the same surface.

The non-mechanical matchers above are the migration's sharp edge: they are runtime string comparisons, so a missed one fails silently (returns `undefined`) rather than loudly. They flip in lockstep with the property rename.

## Migration

The persistence migration mirrors the established schema-version path (the `ensureSubsystemSchema` + version-gate pattern already used for the v12 column rename): bump the topo schema version, rename the table and index, rename the JSON key, bump the topo-graph schema version so existing committed `.trails/topo.lock` files are rejected and regenerated. No data backfill and no backward-compat read — regeneration via `trails compile` is the forcing function.

Source-side, the codemod extends `scripts/vocab-cutover-rewrite.ts`, which already encodes the prior `follow`→`cross` cutover as rename rules — the same shape applies. A `docs/migration/cross-to-compose.md` guide mirrors the prior surface migration guide.

Per ADR-0001's in-place cutover precedent[^cutover], the ADR record itself is updated in place rather than threaded through supersession: `cross`/`crosses` terms in ADR-0024, ADR-0028, ADR-0003, and the incidental mentions elsewhere are rewritten in place, and ADR-0001 gains a **Cutover 4** entry in its running log pointing at this ADR. No ADR is superseded.

## Non-goals

- This does not reconsider other lexicon terms. `mount` (cross-*app* composition) is unaffected; the only relationship worth noting is that in-app composition is now `composes`/`compose` while cross-app stays `mount`.
- This is not a behavior change. The execution pipeline, intent propagation, permit inheritance, and trace nesting are unchanged — only the names move.

## Consequences

### Positive

- A reader hits `composes` / `ctx.compose` / "composite trail" and understands it without a translation step — and the word reinforces that composition is structural, not a one-off call.
- One root across the whole surface (noun, declaration, verb, types, persistence) — nothing to reconcile between layers.
- The framework keeps modeling composition as a first-class, queryable relationship, and now the vocabulary says so.

### Tradeoffs

- A wide, cross-cutting rename touching source, persistence, warden, docs, and the ADR record. It is mechanical in bulk but has a handful of logic-aware spots and a schema migration — it earns its own staged execution.
- `ctx.compose()` is a hair less obviously "an invocation that returns a value" than `ctx.call()` would have been in pure isolation. In context — declared `composes:`, a composite trail — it reads right, and the structural meaning is the priority.

### Risks

- A missed runtime string-literal matcher fails silently. *Mitigation:* the matchers are enumerated on TRL-784; warden coverage and the example suite catch behavioral drift.
- Downstream apps with committed `.trails/topo.lock` fail to read until regenerated. *Mitigation:* this is intentional and correct — the schema-version bump produces an actionable regenerate message.

## Non-decisions

- The exact split between codemod-automated and hand-edited changes for the non-mechanical matchers is left to implementation.
- The `composeInput` field name follows from the `compose` decision (consistent with `ComposeFn` / `ctx.compose`); the earlier `callInput` vs `composeInput` question is therefore closed.

## References

- TRL-784 — the tracking issue carrying the full file:line census, the cutover blast radius, and the dependency blockers.[^trl784]
- `.agents/memory/decisions.md` — the logged decision (2026-05-24, verb reversed call→compose 2026-05-25).
- [ADR-0001: Naming Conventions](0001-naming-conventions.md#a-note-on-the-adr-record) — the brand-vs-plain heuristic and the in-place cutover precedent; gains a Cutover 4 log entry pointing here.
- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md) — the unified trail primitive whose composition field and runtime call were renamed in place.
- [ADR-0024: Typed Trail Composition](0024-typed-trail-composition.md) — the composition contract this renames in place (`crossInput` → `composeInput`).
- [ADR-0028: Concurrent Trail Composition](0028-concurrent-crossing.md) — the concurrent `ctx.compose([...])` overload after this in-place rename.
- The prior `follow`→`cross` cutover, encoded in `scripts/vocab-cutover-rewrite.ts` — the codemod precedent this extends.

[^trl784]: <https://linear.app/outfitter/issue/TRL-784>
[^cutover]: [ADR-0001 — A note on the ADR record](0001-naming-conventions.md#a-note-on-the-adr-record): the lexicon is cut over in place during pre-1.0 when old names would create more confusion than history value, with each cutover recorded by its own ADR plus a log entry.
