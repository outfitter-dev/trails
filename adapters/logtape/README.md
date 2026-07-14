# @ontrails/logtape

Real LogTape adapter for Trails observability. This extracted package owns the LogTape dependency boundary, keeping `@ontrails/observability` independent of foreign logging libraries.

## Usage

```typescript
import { configure, getConsoleSink } from '@logtape/logtape';
import { createLogtapeSink } from '@ontrails/logtape';

await configure({
  loggers: [{ category: 'app', lowestLevel: 'info', sinks: ['console'] }],
  sinks: { console: getConsoleSink() },
});

const sink = createLogtapeSink();
sink.write({
  category: 'app.http',
  level: 'info',
  message: 'request received',
  metadata: { requestId: 'req_123' },
  timestamp: new Date(),
});
```

The application owns `configure()`; this library only resolves or accepts a configured LogTape logger. It forwards Trails records through LogTape's native `emit()` integration path, preserving the record timestamp, category, structured metadata, and the `warn` to `warning` level translation. Trails redaction occurs before the record reaches this adapter, and `silent` records do not reach LogTape.

## Installation

```bash
bun add @ontrails/observability@beta @ontrails/logtape@beta
```

## Migration

This package is the final LogTape adapter in the pre-v1 hard cut. No compatibility subpath remains; see the logging migration guide for the explicit historical import map.
