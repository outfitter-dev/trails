# @ontrails/observability

Primitive observability contracts for Trails.

This package is the public home for log and trace sink shapes used by Trails apps and adapters. It includes zero-dependency sinks for local and server baselines, plus adapter composition for production observability.

## V1 package boundary

Use `@ontrails/observability` for app-facing observability contracts and sinks: `LogSink`, `TraceSink`, `combine(...)`, console/file sinks, bounded memory sinks, and trace rendering.

`@ontrails/core` owns intrinsic tracing execution: `TraceRecord`, `ctx.trace()`, trace context propagation, and the process-level trace sink registry.

`@ontrails/observability/dev` owns developer-state tooling: query/status trails, the SQLite dev store, sampling helpers, and state maintenance. Import intrinsic trace records, contexts, and the process-level sink registry from `@ontrails/core`.

For v1, OpenTelemetry trace export lives at `@ontrails/observability/otel`; there is no standalone `@ontrails/otel` package. That adapter translates Trails-native `TraceRecord` values to callback-delivered OTel-shaped spans without requiring the OpenTelemetry SDK as a runtime dependency. Use `@ontrails/observability/pino` separately when forwarding log records to a Pino-shaped logger.

```typescript
import {
  combine,
  createConsoleSink,
  createFileSink,
  createMemorySink,
} from '@ontrails/observability';

const sink = combine(
  createConsoleSink(),
  createFileSink('./logs/app.log'),
  createMemorySink({ maxRecords: 500 })
);
```

`createFileSink()` is append-only and does not rotate files. Use external log rotation or a production adapter when retention policy matters.

## Log Forwarding Subpaths

Use `@ontrails/observability/logtape` when forwarding Trails log records to an existing LogTape-shaped logger:

```typescript
import { createLogtapeSink } from '@ontrails/observability/logtape';

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

Use `@ontrails/observability/pino` when an app already owns a Pino logger:

```typescript
import { createPinoSink } from '@ontrails/observability/pino';

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

`@ontrails/logging` was retired before v1. Move sink contracts, console/file sinks, formatters, and bounded memory sinks to `@ontrails/observability`. Use `@ontrails/observability/logtape` for LogTape forwarding, `@ontrails/observability/pino` for Pino forwarding, `@ontrails/observability/dev` for developer-state tooling, and `@ontrails/core` for intrinsic trace contracts.
