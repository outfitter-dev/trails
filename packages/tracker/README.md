# @ontrails/tracker

Automatic trail execution recording — just add a gate.

Tracker wraps every trail invocation to capture timing, status, and parentage, then writes records to a sink. Supports intent-based sampling, manual instrumentation through spans and annotations, and multiple backends (memory, SQLite dev store, OpenTelemetry).

## The core pattern

### 1. Create a sink

```typescript
import { createMemorySink } from '@ontrails/tracker';

const sink = createMemorySink();
```

Sinks receive completed Track records. Use a memory sink for testing, a dev store for local development, or an OTel connector to forward to your collector.

### 2. Create a gate and register it

```typescript
import { createTrackerGate } from '@ontrails/tracker';

const gate = createTrackerGate(sink);
```

The gate intercepts every trail and wraps its execution. No trails need to change — tracking is automatic.

## The tracker provision

Access tracker state from any trail:

```typescript
import { trackerProvision } from '@ontrails/tracker';

export const checkStatus = trail('status.check', {
  provisions: [trackerProvision],
  blaze: (_input, ctx) => {
    const state = trackerProvision.from(ctx);
    return Result.ok({
      active: state.active,
      recordCount: state.store?.count() ?? 0,
    });
  },
});
```

## Trail definitions

### `tracker.status`

Reports the current tracking state — active status, record count, sampling config.

### `tracker.query`

Query execution history from the dev store:

The trail accepts these inputs:

- `trailId` — filter by trail ID
- `errorsOnly` — show only failed executions
- `traceId` — retrieve a full trace tree
- `limit` — cap the number of results

Use `run()` or `ctx.cross('tracker.query', { trailId: 'user.create' })` to invoke it programmatically.

## Sinks

### Memory sink

For testing and demos:

```typescript
const sink = createMemorySink();
const gate = createTrackerGate(sink);

// ... run trails ...

expect(sink.records).toHaveLength(3);
expect(sink.records[0]?.status).toBe('ok');
```

### Dev store

SQLite-backed persistence for local development:

```typescript
import { createDevStore } from '@ontrails/tracker';

const store = createDevStore({
  path: './debug.db',
  maxRecords: 50000,
  maxAge: 1000 * 60 * 60 * 24 * 30,
});

const gate = createTrackerGate(store);
```

The dev store uses WAL mode and prunes automatically.

### OpenTelemetry connector

Export traces to any OTel-compatible collector:

```typescript
import { createOtelConnector } from '@ontrails/tracker';

const sink = createOtelConnector({
  exporter: async (spans) => {
    await myOtelCollector.send(spans);
  },
  batchSize: 50,
});
```

The connector translates Track records to OTel spans with Trails-namespaced attributes (`trails.trail.id`, `trails.intent`, `trails.trailhead`, `trails.permit.id`).

## Sampling

By default, tracker samples traces based on intent:

- `read` operations: sampled (low rate)
- `write` operations: 100%
- `destroy` operations: 100%

Override sampling per gate:

```typescript
const gate = createTrackerGate(sink, {
  sampling: { read: 0.1, write: 1.0, destroy: 1.0 },
  keepOnError: true, // Promote sampled-out traces if they fail
});
```

## Manual instrumentation

### Spans

Create child spans within a trail to break timing into segments:

```typescript
import { tracker } from '@ontrails/tracker';

export const processUser = trail('user.process', {
  blaze: async (input, ctx) => {
    const api = tracker.from(ctx);
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
const api = tracker.from(ctx);
api.annotate({ userId: input.userId, dataSize: bytes });
```

## Testing

```typescript
import { createMemorySink, createTrackerGate } from '@ontrails/tracker';
import { testAll } from '@ontrails/testing';

const sink = createMemorySink();
const results = testAll(app, {
  gates: [createTrackerGate(sink)],
});

expect(sink.records).toHaveLength(5);
expect(sink.records.filter((r) => r.status === 'err')).toHaveLength(0);
```

## Installation

```bash
bun add @ontrails/tracker
```
