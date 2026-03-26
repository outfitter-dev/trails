# @ontrails/logging

Structured logging for Trails. One API: `createLogger(config)`. Built-in sinks and formatters, hierarchical category filtering, automatic redaction, and an optional LogTape adapter.

## Installation

```bash
bun add @ontrails/logging @ontrails/core
```

For LogTape integration:

```bash
bun add @logtape/logtape
```

## Quick Start

```typescript
import { createLogger } from '@ontrails/logging';

const logger = createLogger({
  name: 'app.entity',
  level: 'info',
});

logger.info('Entity created', { entityId: 'e1', name: 'Alpha' });
// 10:00:00 INFO  [app.entity] Entity created  entityId=e1 name=Alpha
```

## API Overview

### `createLogger(config)`

The single entry point. Returns a `Logger` (from `@ontrails/core`) that plugs directly into `TrailContext.logger`.

```typescript
const logger = createLogger({
  name: 'app.db.queries',
  level: 'info',
  levels: {
    app: 'info',
    'app.db': 'debug',
    'app.http': 'warn',
  },
  sinks: [createConsoleSink(), createFileSink({ path: './app.log' })],
  redaction: { sensitiveKeys: ['password', 'token'] },
});
```

### Sinks

A `LogSink` receives formatted log records and writes them somewhere.

```typescript
import { createConsoleSink, createFileSink } from '@ontrails/logging';

// Console output (default sink)
createConsoleSink({ formatter: createPrettyFormatter() });

// File output
createFileSink({ path: './logs/app.log', formatter: createJsonFormatter() });
```

### Formatters

```typescript
import { createJsonFormatter, createPrettyFormatter } from '@ontrails/logging';

// Structured JSON -- one object per line, ISO 8601 timestamps
createJsonFormatter();
// {"level":"info","message":"Entity created","category":"app.entity","timestamp":"2026-03-25T10:00:00.000Z"}

// Human-readable -- optional ANSI colors, compact metadata
createPrettyFormatter();
// 10:00:00 INFO  [app.entity] Entity created  entityId=e1
```

### Hierarchical Category Filtering

Categories are dot-separated. Level resolution walks up the hierarchy until a match is found:

```typescript
const logger = createLogger({
  name: 'app.db.queries',
  level: 'info', // global fallback
  levels: {
    app: 'info',
    'app.db': 'debug', // matches "app.db.queries"
    'app.http': 'warn',
  },
});
```

Resolution for `"app.db.queries"`: check exact match, then `"app.db"` (found: `"debug"`), then `"app"`, then `config.level`, then `TRAILS_LOG_LEVEL` env var, then `"info"`.

### Child Loggers

```typescript
const child = logger.child({ requestId: 'abc-123', trail: 'entity.show' });
child.info('Processing');
// Every log record from this child includes requestId and trail metadata
```

Children inherit the parent's sinks, level config, and redaction. They share the parent's sink pipeline.

### Redaction

Sensitive data is automatically stripped before any sink dispatch. Uses `@ontrails/core/redaction` under the hood.

```typescript
const logger = createLogger({
  name: 'app',
  redaction: {
    patterns: [/custom-secret-\w+/g],
    sensitiveKeys: ['password', 'internalToken'],
  },
});

logger.info('Auth', { user: 'admin', password: 'hunter2' });
// password is redacted: "[REDACTED]"
```

### Environment Configuration

Log level can be set via environment:

1. Explicit `config.level` (highest priority)
2. `config.levels` hierarchy
3. `TRAILS_LOG_LEVEL` env var
4. `TRAILS_ENV` profile defaults (`development` = `"debug"`, `test` = silent)
5. Fallback: `"info"`

### LogTape Adapter (`@ontrails/logging/logtape`)

Bridge Trails logging to an existing LogTape infrastructure:

```typescript
import { logtapeSink } from '@ontrails/logging/logtape';
import { getLogger } from '@logtape/logtape';

const logger = createLogger({
  name: 'app',
  sinks: [logtapeSink({ logger: getLogger('app') })],
});
```

`@logtape/logtape` is an optional peer dependency. The main package does not depend on it.

## Subpath Exports

| Export | Contents |
| --- | --- |
| `@ontrails/logging` | `createLogger`, `createConsoleSink`, `createFileSink`, `createJsonFormatter`, `createPrettyFormatter`, level resolution |
| `@ontrails/logging/logtape` | `logtapeSink` adapter (requires `@logtape/logtape` peer) |

## Further Reading

- [Getting Started](../../docs/getting-started.md)
- [Architecture](../../docs/architecture.md)
