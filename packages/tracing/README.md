# @ontrails/tracing

Compatibility and developer-state tooling for the intrinsic tracing that ships
in `@ontrails/core`.

Tracing is built into `executeTrail`. When a real sink is installed, each trail execution writes a root `TraceRecord` automatically, `ctx.trace()` writes child spans, typed signal fan-out writes `signal.*` lifecycle records, and runtime materializers write activation boundary records. When `NOOP_SINK` is installed, the tracing path short-circuits and `ctx.trace()` remains a passthrough. This package re-exports the core tracing primitives for compatibility and provides tracing-specific local tooling: sampling helpers, the tracing resource, query/status trails, the SQLite dev store, dev-state maintenance helpers, and the OpenTelemetry adapter. See [ADR-0041](../../docs/adr/0041-unified-observability.md) for the v1 observability boundary and [ADR-0023](../../docs/adr/0023-simplifying-the-trails-lexicon.md) for the rename history.

## V1 package boundary

Use `@ontrails/observe` for the production observability boundary: log and
trace sink contracts, `combine(...)`, console/file sinks, bounded memory sinks,
and trace tree rendering.

Use `@ontrails/tracing` when you need compatibility imports for core tracing
primitives or tracing-specific developer-state APIs such as `tracingResource`,
`tracingStatus`, `tracingQuery`, `createDevStore`, sampling helpers, or
dev-store cleanup helpers.

The `@ontrails/tracing/otel` subpath remains the supported v1 OpenTelemetry
adapter path. It exports adapter-named APIs such as `createOtelAdapter` and
`OtelAdapterOptions`; no separate `@ontrails/otel` package is required for v1.

## The core pattern

### 1. Register a sink

```typescript
import { createMemorySink, registerTraceSink } from '@ontrails/tracing';

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

### 3. Manual spans inside a blaze

Use `ctx.trace(label, fn)` to record nested spans for substeps:

```typescript
export const processUser = trail('user.process', {
  blaze: async (input, ctx) => {
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
  blaze: (_input, ctx) => {
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

Invoke programmatically via `run()` or `ctx.cross('tracing.query', { trailId: 'user.create' })`.

## Sinks

### Memory sink

For testing and demos:

```typescript
import { createMemorySink } from '@ontrails/observe';
import { registerTraceSink, clearTraceSink } from '@ontrails/tracing';

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

`createMemorySink()` is bounded by default. Older records drop once `maxRecords`
is reached, and `sink.droppedCount` reports how many were discarded since the
last `sink.clear()`. `createBoundedMemorySink()` is an explicit alias for the
same factory. `clearTraceSink()` restores `NOOP_SINK`.

### Dev store

SQLite-backed persistence for local development:

```typescript
import {
  createDevStore,
  registerTraceSink,
  registerTraceStore,
} from '@ontrails/tracing';

const store = createDevStore({
  path: './debug.db',
  maxRecords: 50000,
  maxAge: 1000 * 60 * 60 * 24 * 30,
});
registerTraceSink(store);
registerTraceStore(store);
```

The dev store uses WAL mode and prunes automatically. Use `toTraceStore(store)`
only when you need a read-only view for consumers that must not own the
underlying writable connection.

### OpenTelemetry adapter

Export traces to any OTel-compatible collector:

```typescript
import { createOtelAdapter } from '@ontrails/tracing/otel';
import { registerTraceSink } from '@ontrails/tracing';

const sink = createOtelAdapter({
  exporter: async (spans) => {
    await myOtelCollector.send(spans);
  },
  batchSize: 50,
});
registerTraceSink(sink);
```

The adapter translates `TraceRecord` records to OTel spans with Trails-namespaced attributes (`trails.trail.id`, `trails.intent`, `trails.surface`, `trails.permit.id`).

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
import { registerTraceSink, clearTraceSink } from '@ontrails/tracing';
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
bun add @ontrails/tracing
```
