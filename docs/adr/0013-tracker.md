---
id: 13
slug: tracker
title: Tracker — Runtime Recording Primitive
status: accepted
created: 2026-03-30
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0013: Tracker — Runtime Recording Primitive

> **Status update (2026-04-08):** Partially superseded by [ADR-0023: Simplifying the Trails Lexicon](0023-simplifying-the-trails-lexicon.md) and implemented via TRL-196. The tracker→tracing rename, the trackerGate → intrinsic-in-`executeTrail` collapse, and the `ctx.trace(label, fn)` API replacing `tracker.from(ctx).track(...)` all land through that ADR. The underlying recording, sink, and sampling design described here still governs; only the attachment mechanism and naming changed.

## Context

The framework can already declare what a trail is, what it needs, and how it behaves. What it still needs is a first-class record of what actually happened at runtime:

- which trail ran
- how long it took
- what permit or loadout was involved
- which crossings happened
- where an error occurred
- how a nested execution chain fit together

The architecture already has a natural chokepoint for recording this evidence. `executeTrail` (ADR-0006) is the shared function every trailhead uses for every trail invocation. One gate wrapping that function can record everything. No per-trail instrumentation. No per-trailhead instrumentation. No opt-in ceremony for the common path.

The previous `tracker` language captured the metaphor, but it blurred the infrastructure boundary. "Tracker" tried to be both the primitive and the user-facing story. The cleaner split is:

- a **track** is one recorded footprint
- the **tracker** is the primitive that records and queries tracks

This framing makes the system easier to extend. Signal delivery, trailhead catch-up, execution replay, and debugging all depend on the same underlying recorded sequence. The primitive should say what it is.

## Decision

### Trails-native model, translated outward

The core recording model remains Trails-shaped. A `Track` knows about trail IDs, intents, permits, trailheads, and crossings. Export formats translate outward from that model rather than defining it.

### Provision plus gate hybrid

The tracker integrates in two ways:

- **`trackerGate`** records every trail execution automatically
- **`tracker` provision** gives trail implementations manual access to scoped recording

The automatic path is the default. The manual path exists for trails that need extra detail around internal work.

```typescript
const result = await tracker.from(ctx).track('db-query', async () => {
  return db.from(ctx).search(input.query);
});

tracker.from(ctx).annotate({ userId: input.userId });
```

### Flat records, tree views

Storage stays flat. Each `Track` is an independent row with explicit lineage:

```typescript
interface Track {
  readonly id: string;
  readonly traceId: string;
  readonly rootId: string;
  readonly parentId?: string;
  readonly kind: 'trail' | 'span';
  readonly name: string;
  readonly trailId?: string;
  readonly trailhead?: 'cli' | 'mcp' | 'http' | 'ws';
  readonly intent?: Intent;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly status: 'ok' | 'err' | 'cancelled';
  readonly errorCategory?: string;
  readonly permit?: { id: string; tenantId?: string };
  readonly attrs: Record<string, unknown>;
}
```

Tree rendering happens at query time. Storage, retention, and export stay simple.

### Crossing propagation through execution scope

The shared execution scope already exists for nested calls. The tracker piggybacks on it.

When `trackerGate` wraps a root invocation, it writes `traceId` and the root track ID into scope. When that trail crosses another trail, the child inherits the same trace and parent linkage. No extra plumbing leaks into application code.

### Root-level sampling

Sampling happens at the root trace. Once a trace is sampled in, all descendant tracks are kept. Once it is sampled out, descendants are skipped unless the trace is promoted by error.

Intent-based defaults still make sense:

- `read` — sampled
- `write` — kept
- `destroy` — kept

The exact percentages can evolve, but the invariant should not: a kept trace remains complete.

### Callback-only manual API in v1

The manual API is callback-based to guarantee closure:

```typescript
tracker.from(ctx).track('db-query', async () => {
  // timed, parented, auto-closed
});
```

No raw `start` / `end` pair in v1. Structural safety beats flexibility here.

### Dev store and export connectors

The development store remains local SQLite. Production export remains an optional connector. The important language change is that these are **connectors**, not connectors. The tracker owns the Trails-native model; connectors translate it into storage or observability systems.

## Consequences

### Positive

- **Every trail execution can be recorded with zero per-trail ceremony.** `trackerGate` wraps the shared execution pipeline instead of relying on ad hoc instrumentation.
- **The primitive is honest.** Tracker is infrastructure, not just a debugging nicety.
- **The atomic unit is explicit.** A track is one footprint, which makes lineage, retention, and export easier to describe.
- **The naming composes better with future work.** Signal delivery, replay, and trailhead catch-up can all talk about the tracker without inheriting a narrow observability metaphor.

### Tradeoffs

- **This is a rename plus a conceptual reframing.** The package, exports, docs, and surrounding language all need to move together.
- **`track` as a verb and noun needs careful API naming.** The ergonomic win is worth the extra review attention.

### What this does NOT decide

- the exact production connector set
- replay or catch-up semantics
- long-lived manual spans beyond the callback API
- compliance-grade immutable audit retention

## References

- [ADR-0004: Intent as a First-Class Property](0004-intent-as-first-class-property.md)
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md)
- [ADR-0009: Provisions as a First-Class Primitive](0009-first-class-provisions.md)
- [ADR-0012: Connector-Agnostic Permits](0012-connector-agnostic-permits.md)
- [Vocabulary](../lexicon.md)
