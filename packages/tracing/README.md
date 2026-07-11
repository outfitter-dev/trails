# @ontrails/tracing

Compatibility and developer-state tooling for the intrinsic tracing that ships in `@ontrails/core`.

Tracing is built into `executeTrail`. When a real sink is installed, each trail execution writes a root `TraceRecord` automatically, `ctx.trace()` writes child spans, typed signal fan-out writes `signal.*` lifecycle records, and runtime materializers write activation boundary records. When `NOOP_SINK` is installed, the tracing path short-circuits and `ctx.trace()` remains a passthrough. This package re-exports the core tracing primitives for compatibility and provides tracing-specific local tooling: sampling helpers, the tracing resource, query/status trails, the SQLite dev store, dev-state maintenance helpers, and the OpenTelemetry adapter. See [ADR-0041](../../docs/adr/0041-unified-observability.md) for the v1 observability boundary and [ADR-0023](../../docs/adr/0023-simplifying-the-trails-lexicon.md) for the rename history.

## V1 package boundary

Use `@ontrails/observe` for the production observability boundary: log and trace sink contracts, `combine(...)`, console/file sinks, bounded memory sinks, and trace tree rendering.

Use `@ontrails/tracing` when you need compatibility imports for core tracing primitives or tracing-specific developer-state APIs such as `tracingResource`, `tracingStatus`, `tracingQuery`, `createDevStore`, sampling helpers, or dev-store cleanup helpers.

The `@ontrails/tracing/otel` subpath is the supported v1 OpenTelemetry adapter path. It exports adapter-named APIs such as `createOtelAdapter`, `OtelAdapterOptions`, `OtelExporter`, and `OtelSpan`; no separate `@ontrails/otel` package exists for v1. Trails keeps the internal trace model native to `TraceRecord`, then translates outward at this subpath so the adapter does not force an OpenTelemetry SDK dependency on every tracing user.

Compatibility exports in this package are shims, not second implementations. Core owns `TraceRecord`, trace context, sink registration, activation records, and signal trace writing. Observe owns bounded memory sink behavior. This package re-exports or wraps those owners so older imports continue to work while new code can import from the natural owner directly.

For migration, `@ontrails/tracing` still re-exports core tracing primitives such as `registerTraceSink`, `clearTraceSink`, and `NOOP_SINK`. New code should import those primitives from `@ontrails/core`.

## The core pattern

### 1. Register a sink

```typescript
import { createMemorySink } from '@ontrails/observe';
import { registerTraceSink } from '@ontrails/core';

const sink = createMemorySink({ maxRecords: 1000 });
registerTraceSink(sink);
```

Sinks receive completed `TraceRecord` records. The default sink is `NOOP_SINK` — tracing APIs still work without configuration, but root/span/signal/activation record allocation is skipped until you register a real sink. Use `@ontrails/observe` for app-level sink contracts and zero-dependency sinks, use this package's dev store for local tracing state, or use the OTel adapter to forward to your collector. Use `registerTraceSink(NOOP_SINK)` or `clearTraceSink()` to switch back to the silent baseline.

Signal fan-out records use lexicon-aligned names: `signal.fired`, `signal.invalid`, `signal.handler.invoked`, `signal.handler.completed`, and `signal.handler.failed`. Signal record attrs carry IDs and redacted payload summaries, never raw payloads by default.

Activation boundaries record as `kind: "activation"` when a runtime materializer owns the trigger. The built-in names are `activation.scheduled`, `activation.webhook`, `activation.webhook.invalid`, and `activation.cycle_detected`. Activated trail and signal records still carry `trails.activation.*` attrs, so activation can be read either from the boundary event or from the work it caused.

### 2. Run trails

Tracing happens automatically when a real sink is installed. No layer attachment, no per-trail wiring.

```typescript
await run(graph, 'user.create', { name: 'alice' });

// sink.records() now contains a root TraceRecord for the execution
```

### 3. Manual spans inside an implementation

Use `ctx.trace(label, fn)` to record nested spans for substeps:

```typescript
export const processUser = trail('user.process', {
  implementation: async (input, ctx) => {
    const user = await ctx.trace('load-user', async () => {
      return await db.users.get(input.userId);
    });
    const enriched = await ctx.trace('enrich', async () => {
      return await enrich(user);
    });
    return Result.ok(enriched);
  },
});
```

Each `ctx.trace()` call creates a child span under the trail's root trace record when tracing is enabled. Under `NOOP_SINK`, the same API runs as a passthrough.

## The tracing resource

Access tracing state from any trail — for example, to report status or count records:

```typescript
import { tracingResource } from '@ontrails/tracing';

export const checkStatus = trail('status.check', {
  resources: [tracingResource],
  implementation: (_input, ctx) => {
    const state = tracingResource.from(ctx);
    return Result.ok({
      active: state.active,
      recordCount: state.store?.count() ?? 0,
    });
  },
});
```

## Built-in query trails

### `tracingStatus`

Reports the current tracing state — active status, record count, sampling config.

### `tracingQuery`

Query execution history from the dev store. Accepts:

- `trailId` — filter by trail ID
- `errorsOnly` — show only failed executions
- `traceId` — retrieve a full trace tree
- `limit` — cap the number of results

Invoke programmatically via `run()` or `ctx.compose('tracing.query', { trailId: 'user.create' })`.

## Sinks

### Memory sink

For testing and demos:

```typescript
import { createMemorySink } from '@ontrails/observe';
import { clearTraceSink, registerTraceSink } from '@ontrails/core';

const sink = createMemorySink({ maxRecords: 500 });
registerTraceSink(sink);
try {
  // ... run trails ...
  const records = sink.records();
  expect(records).toHaveLength(3);
  expect(records[0]?.status).toBe('ok');
} finally {
  clearTraceSink();
}
```

`createMemorySink()` is bounded by default. Older records drop once `maxRecords` is reached, and `sink.droppedCount` reports how many were discarded since the last `sink.clear()`. The `@ontrails/tracing` export is a compatibility wrapper over the `@ontrails/observe` implementation: prefer `@ontrails/observe` for new sink usage, and keep the tracing import only when migrating older code. `createBoundedMemorySink()` is an explicit alias for the same factory. `clearTraceSink()` restores `NOOP_SINK`.

### Dev store

SQLite-backed persistence for local development:

```typescript
import { registerTraceSink } from '@ontrails/core';
import { createDevStore, registerTraceStore } from '@ontrails/tracing';

const store = createDevStore({
  path: './debug.db',
  maxRecords: 50000,
  maxAge: 1000 * 60 * 60 * 24 * 30,
});
registerTraceSink(store);
registerTraceStore(store);
```

The dev store uses WAL mode and prunes automatically. Use `toTraceStore(store)` only when you need a read-only view for consumers that must not own the underlying writable connection.

### OpenTelemetry adapter

Export traces to any OTel-compatible collector:

```typescript
import { createOtelAdapter } from '@ontrails/tracing/otel';
import { registerTraceSink } from '@ontrails/core';

const sink = createOtelAdapter({
  exporter: async (spans) => {
    await myOtelCollector.send(spans);
  },
  batchSize: 50,
});
registerTraceSink(sink);

// On shutdown, stop accepting work first, then flush queued spans.
await sink.flush();
```

The exporter callback receives `readonly OtelSpan[]` batches. `OtelSpan` contains the OTel-facing shape derived from each `TraceRecord`: `traceId`, `spanId`, optional `parentSpanId`, `operationName`, `startTime`, optional `endTime`, `status`, `kind`, and primitive `attributes`. The adapter is callback-based on purpose: applications can bridge this output to an OTel SDK, collector client, worker queue, or test double without this package importing the SDK.

The stable `trails.*` attribute family includes:

- Trace identity and lineage: `trails.trace.id`, `trails.span.id`, `trails.span.root_id`, `trails.span.parent_id`, `trails.record.kind`, and `trails.record.name`.
- Trail execution context: `trails.trail.id`, `trails.intent`, `trails.surface`, `trails.permit.id`, and `trails.permit.tenant_id`.
- Status and timing: `trails.status`, `trails.error.category`, `trails.sampled`, `trails.timing.started_at_ms`, `trails.timing.ended_at_ms`, and `trails.timing.duration_ms`.
- Signal and activation context: `trails.signal.*` and `trails.activation.*` records, including lifecycle names such as `trails.signal.event` and `trails.activation.event`.

Custom primitive `record.attrs` are forwarded when they are OTel-safe, but they cannot override stable attributes. Raw payload/body/input/output fields, authorization/cookie/token/password/secret fields, and unredacted `error.message` or `exception.message` style fields are filtered. Signal payload summaries remain available through the redacted `trails.signal.payload.*` digest/shape/size attributes.

Lineage follows the Trails-native `TraceRecord` fields. Root records without a parent map to OTel `SERVER`; child spans, composed trails, signal lifecycle records, and activated trails with `parentId` map to `INTERNAL` and keep the same `traceId`. Status maps `ok` to `OK`, `err` to `ERROR`, and `cancelled` to `UNSET`; the Trails error category remains on `trails.error.category`.

`batchSize` must be a positive integer and defaults to `1`, which means every write flushes immediately unless you set a higher value. Writes auto-flush when the buffer reaches that threshold, and `flush()` drains any remaining records. Concurrent `flush()` calls share the same in-flight drain. If the exporter rejects, the failed batch is restored ahead of newer queued records so a later `flush()` can retry without silent loss.

Use `@ontrails/observe` for app-facing sink contracts, `combine(...)`, built-in console/file/memory sinks, and trace tree rendering. Use `@ontrails/pino` when you need to forward Trails log records to a Pino-shaped logger. The OTel adapter is trace export only; it complements those packages rather than replacing the observability boundary.

## Sampling

Sampling configuration controls recording volume per intent:

- `read` operations: sampled (low rate by default)
- `write` operations: 100%
- `destroy` operations: 100%

```typescript
import { shouldSample, DEFAULT_SAMPLING } from '@ontrails/tracing';

const config = { ...DEFAULT_SAMPLING, read: 0.1 };
if (shouldSample('read', config)) {
  // ...record
}
```

## Testing

```typescript
import { createMemorySink } from '@ontrails/observe';
import { clearTraceSink, registerTraceSink } from '@ontrails/core';
import { testAll } from '@ontrails/testing';

const sink = createMemorySink();
registerTraceSink(sink);
try {
  testAll(app);
  const records = sink.records();
  expect(records).toHaveLength(5);
  expect(records.filter((r) => r.status === 'err')).toHaveLength(0);
} finally {
  clearTraceSink();
}
```

Use `clearTraceSink()` or `registerTraceSink(NOOP_SINK)` to switch back to the silent baseline between tests.

## Installation

```bash
bun add @ontrails/core @ontrails/observe @ontrails/tracing
```
