# @ontrails/logging

Structured logging for Trails. One entry point: `createLogger`. Built-in sinks and formatters, hierarchical category filtering, automatic redaction, and an optional LogTape connector.

## Usage

```typescript
import { createLogger } from '@ontrails/logging';

const logger = createLogger({
  name: 'app.entity',
  level: 'info',
});

logger.info('Entity created', { entityId: 'e1', name: 'Alpha' });
// 10:00:00 INFO  [app.entity] Entity created  entityId=e1 name=Alpha
```

The returned `Logger` plugs directly into `TrailContext.logger`.

## API

| Export | What it does |
| --- | --- |
| `createLogger(config)` | Create a logger with sinks, formatters, and level config |
| `createConsoleSink(options?)` | Sink that writes to the console |
| `createFileSink(options)` | Sink that writes to a file |
| `createJsonFormatter()` | One JSON object per line, ISO timestamps |
| `createPrettyFormatter()` | Human-readable with optional ANSI colors |

See the [API Reference](../../docs/api-reference.md) for the full list.

## Hierarchical filtering

Categories are dot-separated. Level resolution walks up the hierarchy:

```typescript
const logger = createLogger({
  name: 'app.db.queries',
  level: 'info',
  levels: {
    app: 'info',
    'app.db': 'debug',   // matches "app.db.queries"
    'app.http': 'warn',
  },
});
```

Resolution for `"app.db.queries"`: exact match, then `"app.db"` (debug), then `"app"`, then `config.level`, then `TRAILS_LOG_LEVEL`, then `"info"`.

## Child loggers

```typescript
const child = logger.child({ requestId: 'abc-123', trail: 'entity.show' });
child.info('Processing');
// Every record from this child includes requestId and trail metadata
```

Children inherit sinks, level config, and redaction from the parent.

## Redaction

Sensitive data is stripped before sink dispatch, using `@ontrails/core/redaction`:

```typescript
const logger = createLogger({
  name: 'app',
  redaction: { sensitiveKeys: ['password', 'token'] },
});

logger.info('Auth', { user: 'admin', password: 'hunter2' });
// password → "[REDACTED]"
```

## LogTape connector

Bridge to an existing LogTape setup via the `/logtape` subpath:

```typescript
import { logtapeSink } from '@ontrails/logging/logtape';
import { getLogger } from '@logtape/logtape';

const logger = createLogger({
  name: 'app',
  sinks: [logtapeSink({ logger: getLogger('app') })],
});
```

`@logtape/logtape` is an optional peer dependency.

## Installation

```bash
bun add @ontrails/logging @ontrails/core
```
