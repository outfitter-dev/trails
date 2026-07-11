# @ontrails/observe

Primitive observability contracts for Trails.

This package is the public home for log and trace sink shapes used by Trails apps and adapters. It includes zero-dependency sinks for local and server baselines, plus adapter composition for production observability.

## V1 package boundary

Use `@ontrails/observe` for app-facing observability contracts and sinks: `LogSink`, `TraceSink`, `combine(...)`, console/file sinks, bounded memory sinks, and trace rendering.

`@ontrails/core` owns intrinsic tracing execution: `TraceRecord`, `ctx.trace()`, trace context propagation, and the process-level trace sink registry.

`@ontrails/tracing` remains a compatibility and developer-state package for tracing-specific local tooling: query/status trails, the SQLite dev store, sampling helpers, and the supported `@ontrails/tracing/otel` OpenTelemetry adapter subpath.

For v1, OpenTelemetry trace export lives at `@ontrails/tracing/otel`; there is no standalone `@ontrails/otel` package. That adapter translates Trails-native `TraceRecord` values to callback-delivered OTel-shaped spans without requiring the OpenTelemetry SDK as a runtime dependency. Use `@ontrails/observe/pino` separately when forwarding log records to a Pino-shaped logger.

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

`createFileSink()` is append-only and does not rotate files. Use external log rotation or a production adapter when retention policy matters.

## Log Forwarding Subpaths

Use `@ontrails/observe/logtape` when forwarding Trails log records to an existing LogTape-shaped logger:

```typescript
import { createLogtapeSink } from '@ontrails/observe/logtape';

const logger = {
  debug(message: string, props?: Record<string, unknown>) {},
  error(message: string, props?: Record<string, unknown>) {},
  fatal(message: string, props?: Record<string, unknown>) {},
  info(message: string, props?: Record<string, unknown>) {},
  trace(message: string, props?: Record<string, unknown>) {},
  warn(message: string, props?: Record<string, unknown>) {},
};
const sink = createLogtapeSink({ logger });
```

Use `@ontrails/observe/pino` when an app already owns a Pino logger:

```typescript
import { createPinoSink } from '@ontrails/observe/pino';

const logger = {
  debug(payload: Record<string, unknown>, message?: string) {},
  error(payload: Record<string, unknown>, message?: string) {},
  fatal(payload: Record<string, unknown>, message?: string) {},
  info(payload: Record<string, unknown>, message?: string) {},
  trace(payload: Record<string, unknown>, message?: string) {},
  warn(payload: Record<string, unknown>, message?: string) {},
};
const sink = createPinoSink(logger);
```

## Migration from `@ontrails/logging`

`@ontrails/logging` was retired before v1. Move sink contracts, console/file sinks, formatters, and bounded memory sinks to `@ontrails/observe`. Use `@ontrails/observe/logtape` for LogTape forwarding, `@ontrails/observe/pino` for Pino forwarding, and `@ontrails/tracing` for tracing registry, dev-store, query/status, sampling, and OTel adapter APIs.
