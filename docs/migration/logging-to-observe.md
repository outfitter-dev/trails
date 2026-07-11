# Logging To Observe Migration Guide

How to migrate consumers from the retired `@ontrails/logging` package to the v1 observability package graph.

## Current Package Roles

| Need | Use |
| --- | --- |
| Log and trace sink contracts | `@ontrails/observe` |
| Console/file log sinks and formatters | `@ontrails/observe` |
| Bounded in-memory trace sink and trace rendering | `@ontrails/observe` |
| LogTape forwarding | `@ontrails/observe/logtape` |
| Pino forwarding | `@ontrails/observe/pino` |
| Trace sink registry, `ctx.trace()`, and intrinsic execution records | `@ontrails/core` through `executeTrail`; registry helpers are re-exported by `@ontrails/tracing` |
| Tracing query/status trails, SQLite dev store, sampling helpers | `@ontrails/tracing` |
| OpenTelemetry export | `@ontrails/tracing/otel` |

`@ontrails/logging` is no longer part of the workspace or prerelease package set. Do not add it to new apps.

The `@ontrails/observe/logtape` and `@ontrails/observe/pino` subpaths first ship in `1.0.0-beta.40`. The beta.39 package exposes only the root `@ontrails/observe` entrypoint.

## Import Changes

Move sink contracts and built-in sinks to `@ontrails/observe`:

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
+ } from '@ontrails/observe';
```

Rename the LogTape forwarding factory and move it under the observe package:

```diff
- import { logtapeSink } from '@ontrails/logtape';
+ import { createLogtapeSink } from '@ontrails/observe/logtape';
```

Use `@ontrails/tracing/otel` for OpenTelemetry trace export:

```typescript
import { createOtelAdapter } from '@ontrails/tracing/otel';
import { registerTraceSink } from '@ontrails/tracing';

const exporter = async (spans: unknown) => {
  // Forward spans to your collector.
};

const sink = createOtelAdapter({ exporter });
registerTraceSink(sink);

// During shutdown, stop accepting work first, then:
await sink.flush();
```

There is no standalone `@ontrails/otel` package in v1. The adapter keeps the Trails-native `TraceRecord` model internal, emits stable `trails.*` attributes, and forwards OTel-shaped span batches through the exporter callback without forcing an OpenTelemetry SDK runtime dependency.

Use `@ontrails/observe/pino` when an app already owns a Pino logger:

```typescript
import pino from 'pino';
import { topo } from '@ontrails/core';
import { createPinoSink } from '@ontrails/observe/pino';

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
+   "@ontrails/observe": "1.0.0-beta.40",
    "@ontrails/tracing": "1.0.0-beta.40"
  }
}
```

For apps that also forward to a LogTape-shaped logger, use the `@ontrails/observe/logtape` subpath from the same `@ontrails/observe` package:

```diff
{
  "dependencies": {
-   "@ontrails/logging": "^1.0.0-beta.15",
+   "@ontrails/observe": "1.0.0-beta.40",
    "@ontrails/tracing": "1.0.0-beta.40"
  }
}
```

For apps that forward to a Pino-shaped logger, use the `@ontrails/observe/pino` subpath from the same `@ontrails/observe` package. Keep `pino` itself as an application dependency:

```diff
{
  "dependencies": {
-   "@ontrails/logging": "^1.0.0-beta.15",
+   "@ontrails/observe": "1.0.0-beta.40",
+   "@ontrails/tracing": "1.0.0-beta.40",
+   "pino": "^9.0.0"
  }
}
```

## Testing

For trace assertions, install the memory sink from `@ontrails/observe` and the registry helpers from `@ontrails/tracing`:

```typescript
import { createMemorySink } from '@ontrails/observe';
import { registerTraceSink, clearTraceSink } from '@ontrails/tracing';

const sink = createMemorySink({ maxRecords: 100 });
registerTraceSink(sink);

try {
  // run trails and assert against sink.records()
} finally {
  clearTraceSink();
}
```

## What Stays Historical

Changelogs, release notes, and migration guides may still mention `@ontrails/logging`, `@ontrails/tracker`, `trailhead`, or `connector` when they are explicitly describing older beta history. Current-facing docs and examples should use `@ontrails/observe`, `@ontrails/tracing`, `surface`, and `adapter`.
