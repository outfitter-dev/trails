---
id: 4
slug: intent-as-first-class-property
title: Intent as a First-Class Property
status: accepted
created: 2026-03-29
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0004: Intent as a First-Class Property

## Context

Trails needs to know whether a trail is safe to call without side effects, whether it modifies state, or whether it destroys something. Trailheads use this information to derive behavior: HTTP picks a method, MCP sets annotation hints, CLI adds safety flags. The question is how the developer declares it.

Early versions used two booleans:

```typescript
trail({
  readOnly: true,
  destructive: false,
  // ...
});
```

Two booleans create four states. Three are meaningful:

| `readOnly` | `destructive` | Meaning |
| --- | --- | --- |
| `true` | `false` | Read-only query |
| `false` | `false` | State mutation |
| `false` | `true` | Destructive mutation |
| `true` | `true` | **Contradictory** |

The fourth state — read-only and destructive — makes no sense. But the type system permits it. Nothing prevents a developer (or an agent) from setting both to `true` and producing a trail with undefined surface behavior.

This is the kind of invalid state that compounds. Surfaces would need defensive checks. Tests would need to cover the contradictory case. Documentation would need to explain why it's wrong. All of that is waste created by a modeling choice that allows something that shouldn't exist.

A single field with three values models the domain exactly. No invalid states. No defensive checks. One field, three meanings, zero ambiguity.

## Decision

### `intent` replaces the two booleans

Every trail declares `intent` as one of three values:

```typescript
type Intent = 'read' | 'write' | 'destroy';
```

The default is `'write'`. If you don't declare intent, the framework assumes your trail mutates state. This is the safe default — read-only trails opt in to the lighter treatment, not the other way around.

```typescript
trail({
  id: 'user.list',
  intent: 'read',
  input: z.object({ limit: z.number().optional() }),
  // ...
});
```

### Surface derivation from intent

The developer declares intent. The framework derives surface behavior. Each surface has an explicit lookup table — no conditionals, no fallback chains.

**HTTP** — method and input source:

```typescript
const intentToMethod: Record<string, HttpMethod> = {
  destroy: 'DELETE',
  read: 'GET',
  write: 'POST',
};
```

Input source follows from method: `GET` reads from query parameters, `POST` and `DELETE` read from the request body.

**MCP** — annotation hints:

```typescript
const intentToHint: Partial<Record<Intent, string>> = {
  destroy: 'destructiveHint',
  read: 'readOnlyHint',
};
```

A `'write'` trail sets no hint — the MCP SDK defaults apply. A `'read'` trail sets `readOnlyHint: true`. A `'destroy'` trail sets `destructiveHint: true`.

**CLI** — safety presets:

A `'destroy'` trail automatically receives a `--dry-run` flag preset. The developer doesn't add it. The framework adds it because destroy trails should always offer a dry run.

```typescript
if (intent === 'destroy') {
  flags = mergeFlags(dryRunPreset(), flags);
}
```

### `idempotent` stays separate

`idempotent` is a separate boolean on the trail spec, not a fourth intent value. Idempotency is orthogonal to intent: a write can be idempotent (PUT-style upsert), a destroy can be idempotent (deleting an already-deleted resource is a no-op), and a read is inherently idempotent.

Folding idempotency into intent would create a combinatorial explosion (`'idempotent-write'`, `'idempotent-destroy'`). Keeping it as a separate boolean preserves the clean three-value intent model while still surfacing idempotency where it matters — MCP's `idempotentHint` and HTTP's method semantics.

### This is framework knowledge

The mapping tables above live in surface packages, not in trail definitions. The developer writes `intent: 'read'`. The HTTP surface knows that means GET. The MCP surface knows that means `readOnlyHint: true`. The CLI surface knows that means no dry-run preset. The developer doesn't need to know any of this. They declare what the trail does; the framework handles how each surface represents it.

## Consequences

### Positive

- **No invalid states.** Three values, three meanings. The type system rejects anything else.
- **One field drives all surfaces.** A single `intent` declaration produces the correct HTTP method, MCP annotation, and CLI flag behavior. No per-surface configuration.
- **Clear semantic meaning.** `intent: 'destroy'` communicates more than `readOnly: false, destructive: true`. The code reads like prose.
- **Safe default.** Defaulting to `'write'` means trails are treated as state-mutating unless explicitly marked otherwise. You opt into lighter treatment, not out of safety.

### Tradeoffs

- **Three values may not cover all future needs.** A `'create'` intent distinct from `'write'` would map naturally to HTTP POST vs PUT. For now, `'write'` with `idempotent: true` covers the PUT case, but if the distinction matters more in the future, the enum may need a fourth value.
- **Default is invisible.** A trail without an explicit `intent` behaves as `'write'`. This is the correct default, but it means agents and reviewers can't tell from the source whether the omission was intentional or accidental. The warden can flag missing intent as a coaching suggestion.

### What this does NOT decide

- Whether additional intent values will be added in the future
- How `intent` interacts with authorization or access control (that's a separate concern)
- Whether surfaces can override the derived behavior (currently they cannot — the mapping is deterministic)

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — derive by default, override deliberately; the information architecture categories
- [ADR-0008: Deterministic Surface Derivation](0008-deterministic-trailhead-derivation.md) — the broader pattern of which intent is one instance
