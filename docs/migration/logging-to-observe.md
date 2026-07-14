# Logging To Observability Migration Guide

How to migrate consumers from the retired `@ontrails/logging` package to the v1 observability package graph.

## Current Package Roles

| Need | Use |
| --- | --- |
| Log and trace sink contracts | `@ontrails/observability` |
| Console/file log sinks and formatters | `@ontrails/observability` |
| Bounded in-memory trace sink and trace rendering | `@ontrails/observability` |
| LogTape forwarding | `@ontrails/observability/logtape` |
| Pino forwarding | `@ontrails/observability/pino` |
| Trace sink registry, `ctx.trace()`, and intrinsic execution records | `@ontrails/core` through `executeTrail` |
| Tracing query/status trails, SQLite dev store, sampling helpers | `@ontrails/observability/dev` |
| OpenTelemetry export | `@ontrails/observability/otel` |

`@ontrails/logging` is no longer part of the workspace or prerelease package set. Do not add it to new apps.

The `@ontrails/observability/logtape` and `@ontrails/observability/pino` subpaths are temporary stack state. They move to `@ontrails/logtape` and `@ontrails/pino` before v1.

## Import Changes

Move sink contracts and built-in sinks to `@ontrails/observability`:

```diff
- import {
-   createConsoleSink,
-   createFileSink,
-   createJsonFormatter,
-   createPrettyFormatter,
- } from '@ontrails/logging';
+ import {
+   createConsoleSink,
+   createFileSink,
+   createJsonFormatter,
+   createPrettyFormatter,
+ } from '@ontrails/observability';
```

Rename the LogTape forwarding factory and move it under the observability package temporarily:

```diff
- import { logtapeSink } from '@ontrails/logtape';
+ import { createLogtapeSink } from '@ontrails/observability/logtape';
```

Use `@ontrails/observability/otel` for OpenTelemetry trace export:

```typescript
import { registerTraceSink } from '@ontrails/core';
import { createOtelAdapter } from '@ontrails/observability/otel';

const exporter = async (spans: unknown) => {
  // Forward spans to your collector.
};

const sink = createOtelAdapter({ exporter });
registerTraceSink(sink);

// During shutdown, stop accepting work first, then:
await sink.flush();
```

There is no standalone `@ontrails/otel` package in v1. The adapter keeps the Trails-native `TraceRecord` model internal, emits stable `trails.*` attributes, and forwards OTel-shaped span batches through the exporter callback without forcing an OpenTelemetry SDK runtime dependency.

Use `@ontrails/observability/pino` when an app already owns a Pino logger:

```typescript
import pino from 'pino';
import { topo } from '@ontrails/core';
import { createPinoSink } from '@ontrails/observability/pino';

const logger = pino();
// trails is your application's array of Trail definitions.
const graph = topo('app', trails, {
  observe: {
    log: createPinoSink(logger),
  },
});
```

## Package Manifests

Remove the old dependency and add the replacement packages you actually need. For apps that only use console, file, or memory sinks:

```diff
{
  "dependencies": {
-   "@ontrails/logging": "^1.0.0-beta.15",
+   "@ontrails/observability": "1.0.0-beta.42",
    "@ontrails/observability": "1.0.0-beta.42"
  }
}
```

For apps that also forward to a LogTape-shaped logger, use the temporary `@ontrails/observability/logtape` subpath from the same `@ontrails/observability` package:

```diff
{
  "dependencies": {
-   "@ontrails/logging": "^1.0.0-beta.15",
+   "@ontrails/observability": "1.0.0-beta.42",
    "@ontrails/observability": "1.0.0-beta.42"
  }
}
```

For apps that forward to a Pino-shaped logger, use the temporary `@ontrails/observability/pino` subpath from the same `@ontrails/observability` package. Keep `pino` itself as an application dependency:

```diff
{
  "dependencies": {
-   "@ontrails/logging": "^1.0.0-beta.15",
+   "@ontrails/observability": "1.0.0-beta.42",
+   "pino": "^9.0.0"
  }
}
```

## Testing

For trace assertions, install the memory sink from `@ontrails/observability` and the registry helpers from `@ontrails/core`:

```typescript
import { createMemorySink } from '@ontrails/observability';
import { registerTraceSink, clearTraceSink } from '@ontrails/core';

const sink = createMemorySink({ maxRecords: 100 });
registerTraceSink(sink);

try {
  // run trails and assert against sink.records()
} finally {
  clearTraceSink();
}
```

## What Stays Historical

Changelogs and release notes may still mention historical package routes when they are explicitly describing older beta history. Current-facing docs and examples should use `@ontrails/observability`, its `/dev` and `/otel` subpaths where applicable, `surface`, and `adapter`.
