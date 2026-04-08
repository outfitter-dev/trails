# @ontrails/tracing

Automatic trail execution recording — just add a layer.

Tracing wraps every trail invocation to capture timing, status, and parentage, then writes records to a sink. Supports intent-based sampling, manual instrumentation through spans and annotations, and multiple backends (memory, SQLite dev store, OpenTelemetry).

## The core pattern

### 1. Create a sink

```typescript
import { createMemorySink } from '@ontrails/tracing';

const sink = createMemorySink();
```

Sinks receive completed TraceRecord records. Use a memory sink for testing, a dev store for local development, or an OTel connector to forward to your collector.

### 2. Create a layer and register it

```typescript
import { createTracingLayer } from '@ontrails/tracing';

const layer = createTracingLayer(sink);
```

The layer intercepts every trail and wraps its execution. No trails need to change — tracing is automatic.

## The tracing resource

Access tracing state from any trail:

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

## Trail definitions

### `tracing.status`

Reports the current tracking state — active status, record count, sampling config.

### `tracing.query`

Query execution history from the dev store:

The trail accepts these inputs:

- `trailId` — filter by trail ID
- `errorsOnly` — show only failed executions
- `traceId` — retrieve a full trace tree
- `limit` — cap the number of results

Use `run()` or `ctx.cross('tracing.query', { trailId: 'user.create' })` to invoke it programmatically.

## Sinks

### Memory sink

For testing and demos:

```typescript
const sink = createMemorySink();
const layer = createTracingLayer(sink);

// ... run trails ...

expect(sink.records).toHaveLength(3);
expect(sink.records[0]?.status).toBe('ok');
```

### Dev store

SQLite-backed persistence for local development:

```typescript
import { createDevStore } from '@ontrails/tracing';

const store = createDevStore({
  path: './debug.db',
  maxRecords: 50000,
  maxAge: 1000 * 60 * 60 * 24 * 30,
});

const layer = createTracingLayer(store);
```

The dev store uses WAL mode and prunes automatically.

### OpenTelemetry connector

Export traces to any OTel-compatible collector:

```typescript
import { createOtelConnector } from '@ontrails/tracing';

const sink = createOtelConnector({
  exporter: async (spans) => {
    await myOtelCollector.send(spans);
  },
  batchSize: 50,
});
```

The connector translates TraceRecord records to OTel spans with Trails-namespaced attributes (`trails.trail.id`, `trails.intent`, `trails.trailhead`, `trails.permit.id`).

## Sampling

By default, tracing samples traces based on intent:

- `read` operations: sampled (low rate)
- `write` operations: 100%
- `destroy` operations: 100%

Override sampling per layer:

```typescript
const layer = createTracingLayer(sink, {
  sampling: { read: 0.1, write: 1.0, destroy: 1.0 },
  keepOnError: true, // Promote sampled-out traces if they fail
});
```

## Manual instrumentation

### Spans

Create child spans within a trail to break timing into segments:

```typescript
import { tracing } from '@ontrails/tracing';

export const processUser = trail('user.process', {
  blaze: async (input, ctx) => {
    const api = tracing.from(ctx);
    const user = await api.span('load-user', async () => {
      return await db.users.get(input.userId);
    });
    return Result.ok(user);
  },
});
```

### Annotations

Add context to a trail's record:

```typescript
const api = tracing.from(ctx);
api.annotate({ userId: input.userId, dataSize: bytes });
```

## Testing

```typescript
import { createMemorySink, createTracingLayer } from '@ontrails/tracing';
import { testAll } from '@ontrails/testing';

const sink = createMemorySink();
const results = testAll(app, {
  gates: [createTracingLayer(sink)],
});

expect(sink.records).toHaveLength(5);
expect(sink.records.filter((r) => r.status === 'err')).toHaveLength(0);
```

## Installation

```bash
bun add @ontrails/tracing
```
