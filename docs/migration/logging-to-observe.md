# Logging To Observability Migration Guide

How to migrate consumers from the retired `@ontrails/logging` package to the final v1 observability package graph.

## Current Package Roles

| Need | Use |
| --- | --- |
| Log and trace sink contracts, built-in sinks, formatters | `@ontrails/observability` |
| Bounded in-memory trace sink and trace rendering | `@ontrails/observability` |
| Real LogTape forwarding | `@ontrails/logtape` |
| Real Pino forwarding | `@ontrails/pino` |
| Trace sink registry, `ctx.trace()`, and intrinsic execution records | `@ontrails/core` through `executeTrail` |
| Tracing query/status trails, SQLite dev store, sampling helpers | `@ontrails/observability/dev` |
| OpenTelemetry export | `@ontrails/observability/otel` |

`@ontrails/logging` is no longer part of the workspace or prerelease package set. Do not add it to new apps.

Pino and LogTape are extracted packages because they bind Trails records to real third-party libraries. `@ontrails/observability` deliberately remains independent of both libraries, and its former forwarding subpaths have no compatibility aliases.

## Import Changes

Move sink contracts and built-in sinks to `@ontrails/observability`:

```diff
- import { createConsoleSink, createFileSink } from '@ontrails/logging';
+ import { createConsoleSink, createFileSink } from '@ontrails/observability';
```

Use the extracted adapters directly:

```diff
- import { createLogtapeSink } from '@ontrails/observability/logtape';
+ import { createLogtapeSink } from '@ontrails/logtape';

- import { createPinoSink } from '@ontrails/observability/pino';
+ import { createPinoSink } from '@ontrails/pino';
```

Pino can be application-configured or constructed by the adapter:

```typescript
import pino from 'pino';
import { topo } from '@ontrails/core';
import { createPinoSink } from '@ontrails/pino';

const logger = pino({ level: 'info' });
const graph = topo('app', trails, {
  observe: { log: createPinoSink({ logger }) },
});
```

For LogTape, configure the application once and give Trails the adapter sink. The adapter resolves the LogTape category from each Trails record; it never calls `configure()` itself.

## Package Manifests

For apps that only use console, file, or memory sinks, depend on `@ontrails/observability`. Add `@ontrails/logtape` or `@ontrails/pino` only when that real adapter is used. The adapter packages own their foreign library dependencies, although an application that constructs its own Pino logger may also depend on `pino` directly.

## Testing

For trace assertions, install the memory sink from `@ontrails/observability` and the registry helpers from `@ontrails/core`:

```typescript
import { clearTraceSink, registerTraceSink } from '@ontrails/core';
import { createMemorySink } from '@ontrails/observability';

const sink = createMemorySink({ maxRecords: 100 });
registerTraceSink(sink);

try {
  // run trails and assert against sink.records()
} finally {
  clearTraceSink();
}
```

## Historical Routes

`@ontrails/logging` and the former observability forwarding subpaths belong to pre-v1 migration history only. Current source, examples, and package manifests must use the final routes above.
