# Logging To Observe Migration Guide

How to migrate consumers from the retired `@ontrails/logging` package to the
v1 observability package graph.

## Current Package Roles

| Need | Use |
| --- | --- |
| Log and trace sink contracts | `@ontrails/observe` |
| Console/file log sinks and formatters | `@ontrails/observe` |
| Bounded in-memory trace sink and trace rendering | `@ontrails/observe` |
| LogTape forwarding | `@ontrails/logtape` |
| Trace sink registry, `ctx.trace()`, and intrinsic execution records | `@ontrails/core` through `executeTrail`; registry helpers are re-exported by `@ontrails/tracing` |
| Tracing query/status trails, SQLite dev store, sampling helpers | `@ontrails/tracing` |
| OpenTelemetry export | `@ontrails/tracing/otel` |

`@ontrails/logging` is no longer part of the workspace or prerelease package
set. Do not add it to new apps.

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

Rename the LogTape forwarding factory:

```diff
- import { logtapeSink } from '@ontrails/logtape';
+ import { createLogtapeSink } from '@ontrails/logtape';
```

Use `@ontrails/tracing/otel` for OpenTelemetry trace export:

```typescript
import { createOtelAdapter } from '@ontrails/tracing/otel';
import { registerTraceSink } from '@ontrails/tracing';

const exporter = async (spans: unknown) => {
  // Forward spans to your collector.
};

registerTraceSink(createOtelAdapter({ exporter }));
```

## Package Manifests

Remove the old dependency and add the replacement packages you actually need.
For apps that only use console, file, or memory sinks:

```diff
{
  "dependencies": {
-   "@ontrails/logging": "^1.0.0-beta.15",
+   "@ontrails/observe": "^1.0.0-beta.15",
    "@ontrails/tracing": "^1.0.0-beta.15"
  }
}
```

For apps that also forward to a LogTape-shaped logger, add `@ontrails/logtape`
alongside `@ontrails/observe`:

```diff
{
  "dependencies": {
-   "@ontrails/logging": "^1.0.0-beta.15",
+   "@ontrails/observe": "^1.0.0-beta.15",
+   "@ontrails/logtape": "^1.0.0-beta.15",
    "@ontrails/tracing": "^1.0.0-beta.15"
  }
}
```

## Testing

For trace assertions, install the memory sink from `@ontrails/observe` and the
registry helpers from `@ontrails/tracing`:

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

Changelogs, release notes, and migration guides may still mention
`@ontrails/logging`, `@ontrails/tracker`, `trailhead`, or `connector` when they
are explicitly describing older beta history. Current-facing docs and examples
should use `@ontrails/observe`, `@ontrails/tracing`, `surface`, and `adapter`.
