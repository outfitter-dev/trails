---
status: accepted
created: 2026-03-30
updated: 2026-03-30
author: '@galligan'
---

# ADR-013: Tracks

## Context

The framework can now declare what a trail IS (contract via `trail()`), what it NEEDS (services via `service()`), and how it BEHAVES (intent, idempotency, safety presets). What it can't tell you is what actually happened when a trail ran. Did the follow chain complete? How long did the database call take? Did the child trail error while the parent succeeded?

"Tracks" is the reserved vocabulary for this — evidence of what happened on the trails. Footprints, not blueprints.

The architecture has a natural chokepoint for recording this evidence. `executeTrail` (ADR-006) is the single function every surface calls for every trail invocation. One layer wrapping that function records everything. No per-surface instrumentation. No opt-in ceremony.

Follow chains create parent-child relationships. When trail A follows trail B and B follows trail C, that's a trace with three legs. The vocabulary already exists — `follow` for composition, `leg` for individual steps in a follow chain. Tracks makes these relationships queryable after the fact.

This ADR locks after Permits (ADR-012) ships.

## Decision

### Trails-native model, translated to OTel

The core telemetry model is Trails-shaped. A `TrackRecord` knows about trail IDs, intents, permits, surfaces, and follow chains. These are first-class fields, not string-keyed attributes stuffed into a generic span.

OpenTelemetry is the export target, not the source abstraction. The OTel adapter is a mechanical translation: `TrackRecord` fields map to OTel span attributes under a `trails.*` namespace. If OTel vocabulary starts leaking into core — if someone writes `ctx.tracer.startSpan()` in a trail implementation — the model is wrong. The framework's own concepts come first. Industry-standard export is a surface concern.

### Service + layer hybrid

Two integration points, one automatic and one manual:

**`tracksLayer`** — a framework-provided layer that auto-records every trail execution. Wrap it around your topo and every trail invocation produces a `TrackRecord` with timing, status, intent, surface, and parentage. Zero developer effort. This is the default and the common case.

**`tracks` service** — manual instrumentation for when the automatic layer isn't enough. A trail that makes three database calls can distinguish them:

```typescript
const result = await tracks.from(ctx).span('db-query', async () => {
  return db.from(ctx).search(input.query);
});

tracks.from(ctx).annotate({ userId: input.userId });
```

The service reads from context, so it participates in the same trace. Manual spans become children of the trail's automatic record.

### Flat records, tree views

Storage is flat. Every `TrackRecord` is an independent row with explicit parent pointers:

```typescript
interface TrackRecord {
  id: string;
  traceId: string;
  rootId: string;
  parentId?: string;
  kind: 'trail' | 'span';
  name: string;
  trailId?: string;
  surface?: 'cli' | 'mcp' | 'http' | 'ws';
  intent?: Intent;
  startedAt: number;
  endedAt?: number;
  status: 'ok' | 'err' | 'cancelled';
  errorCategory?: string;
  permit?: { id: string; tenantId?: string };
  attrs: Record<string, unknown>;
}
```

Trees are materialized at query time — in CLI output, in survey reports, in the OTel exporter. The storage model stays simple. Flat records are easy to index, easy to retain, easy to export. Tree rendering is a view concern, not a storage concern.

### Follow chain propagation via ExecutionScope

ADR-009 introduced `createFollow(topo, scope)` as the centralized follow factory. Tracks hooks into the same mechanism.

When `tracksLayer` wraps a root invocation, it creates a root `TrackRecord` and writes `traceId` and the record's `id` into the execution scope. When that trail calls `ctx.follow()`, `createFollow` propagates the scope to the child. The child's `tracksLayer` reads the inherited `traceId` and `parentId` from scope and creates a child record. No separate follow factory. No trace context threading through application code. The scope propagation that services already use carries trace context for free.

### Two sampling classes for v1: sampled and kept

Not every trace is worth storing. Read-heavy apps would drown in records. But every destructive operation should be recorded.

Intent-based defaults:

- `read` — sampled at 5%
- `write` — kept (100%)
- `destroy` — kept (100%)

The sampling decision happens at the root trace. Once a trace is sampled in, every child record in the follow chain is kept. Once sampled out, children are skipped. This keeps traces complete — you never get a parent without its children or orphaned child records.

Error promotion: `keepOnError: true` (the default) promotes a sampled-out trace to kept if any record in the chain errors. The data you need most is always there.

An `audit` retention class — immutable, compliance-grade, tamper-evident — is deferred until concrete compliance use cases emerge. The `TrackRecord` schema has room for it. The data model doesn't need to change.

### Manual API: callback-only `span()` for v1

```typescript
tracks.from(ctx).span('db-query', async () => {
  // timed, parented, auto-closed
});

tracks.from(ctx).annotate({ userId: input.userId });
```

No raw `startSpan()` / `endSpan()`. Callbacks guarantee spans close. A forgotten `endSpan()` in an early return or exception path is a common source of telemetry bugs in OTel codebases. The callback pattern makes that class of bug structurally impossible.

The tradeoff: streaming or long-lived spans can't use this API. That's acceptable for v1. If long-lived spans prove necessary, a separate ADR will address them with the same structural safety guarantees.

### Dev store: `bun:sqlite` at `.trails/dev/tracks.db`

Development tracks write to a local SQLite database using `bun:sqlite`. WAL mode for concurrent reads. Persistent across process restarts, queryable across surfaces. The same dev store serves the CLI, MCP, and HTTP surfaces running on the same machine.

This enables `trails tracks` — a CLI command for querying execution history during development:

```bash
trails tracks                    # recent traces
trails tracks --trail user.create  # filter by trail
trails tracks --trace abc123     # full trace tree
trails tracks --errors           # failed traces only
```

Retention is configurable: max trace count, max age, or both. Defaults are generous for development — you shouldn't need to think about retention until production.

The dev store is not the production story. Production uses the OTel adapter to export to whatever backend the team already runs.

### OTel adapter: `@ontrails/tracks/otel`

A subpath export. The OTel SDK is an optional peer dependency — you don't pay for it if you don't use it.

The mapping:

- `TrackRecord.trailId` → `trails.trail.id`
- `TrackRecord.intent` → `trails.intent`
- `TrackRecord.surface` → `trails.surface`
- `TrackRecord.permit.id` → `trails.permit.id`
- `TrackRecord.permit.tenantId` → `trails.permit.tenant_id`
- `TrackRecord.kind` → span kind mapping (`trail` → `INTERNAL`, root trail → `SERVER`)

The smoke test: trail A (`read`) follows trail B (`write`), B emits a manual span, B follows trail C (`destroy`), C errors. The exported OTel trace preserves parentage across all four spans, carries intent and permit on each, and marks C's span as errored with the correct category. If this test passes, the adapter is correct.

### Runtime declaration validation: deferred

Tracks records what happened. It does not validate whether what happened matches what was declared. Questions like "did this `read` trail actually only read?" or "did this follow chain escalate intent correctly?" are behavioral validation — a future ADR topic.

The data for behavioral validation will be there. Every `TrackRecord` carries intent, service access patterns (via manual spans), and follow chain structure. When the validation ADR ships, it reads from tracks. But tracks itself stays focused: record and query. One job, done well.

## Consequences

### Positive

- **Every trail execution is recorded with zero developer effort.** `tracksLayer` wraps `executeTrail`. No per-trail opt-in.
- **Follow chains produce proper parent-child trace relationships.** The execution scope propagation from ADR-009 carries trace context without application code changes.
- **The dev store enables `trails tracks` for debugging.** Persistent, queryable, cross-process. No external infrastructure needed during development.
- **OTel export is a mechanical translation, not a rewrite.** The Trails-native model captures richer semantics. OTel gets them as structured attributes.
- **The same `TrackRecord` feeds dev debugging AND production observability.** One model, two destinations.

### Tradeoffs

- **The `bun:sqlite` dev store adds a write path to development.** Every trail invocation writes a record. WAL mode keeps this fast, but it's not zero-cost. The dev store can be disabled if it's ever a problem.
- **Sampling decisions are root-level.** You can't sample individual spans differently within a trace. This keeps traces complete but limits fine-grained control.
- **Manual span API is callback-only.** No streaming or long-lived spans in v1. The structural safety is worth the constraint for now.

### What this does NOT decide

- **`audit` retention class.** Deferred to compliance use cases.
- **Runtime declaration validation.** Whether recorded behavior matches declared intent is a future ADR. The data will be there.
- **Metrics and counters.** Not in v1. Tracks records individual executions. Aggregation is a query concern or an OTel backend concern.
- **Cross-process trace propagation for `mount()`.** When apps compose via mount, trace context needs to cross process boundaries. That's tied to the mount protocol, not to tracks itself.

## References

- [ADR-006: Shared Execution Pipeline](006-shared-execution-pipeline.md) — `executeTrail` is the chokepoint where `tracksLayer` records execution
- [ADR-009: Services as a First-Class Primitive](009-services.md) — execution scope propagation, `createFollow(topo, scope)`, and the `tracks` service pattern
- [ADR-004: Intent as a First-Class Property](004-intent-as-first-class-property.md) — intent drives sampling defaults and is carried on every `TrackRecord`
