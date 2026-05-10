# @ontrails/observe

Primitive observability contracts for Trails.

This package is the public home for log and trace sink shapes used by Trails
apps and adapters. It includes zero-dependency sinks for local and server
baselines, plus adapter composition for production observability.

## V1 package boundary

Use `@ontrails/observe` for app-facing observability contracts and sinks:
`LogSink`, `TraceSink`, `combine(...)`, console/file sinks, bounded memory
sinks, and trace rendering.

`@ontrails/core` owns intrinsic tracing execution: `TraceRecord`,
`ctx.trace()`, trace context propagation, and the process-level trace sink
registry.

`@ontrails/tracing` remains a compatibility and developer-state package for
tracing-specific local tooling: query/status trails, the SQLite dev store,
sampling helpers, and the supported `@ontrails/tracing/otel` OpenTelemetry
adapter subpath.

```typescript
import {
  combine,
  createConsoleSink,
  createFileSink,
  createMemorySink,
} from '@ontrails/observe';

const sink = combine(
  createConsoleSink(),
  createFileSink('./logs/app.log'),
  createMemorySink({ maxRecords: 500 })
);
```

`createFileSink()` is append-only and does not rotate files. Use external log
rotation or a production adapter when retention policy matters.
