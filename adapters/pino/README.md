# @ontrails/pino

Real Pino adapter for Trails observability. This extracted package owns the Pino dependency boundary, keeping `@ontrails/observability` limited to Trails-native records, sink contracts, redaction, formatters, and built-ins.

## Usage

```typescript
import pino from 'pino';
import { createPinoSink } from '@ontrails/pino';

const logger = pino({ level: 'info' });
const sink = createPinoSink({ logger });

sink.write({
  category: 'app.http',
  level: 'info',
  message: 'request received',
  metadata: { requestId: 'req_123' },
  timestamp: new Date(),
});

await sink.flush();
```

Pass `pinoOptions` and an optional Pino destination when the adapter should construct the logger. For an asynchronously buffered destination, await `sink.flush()` before shutdown so accepted records reach Pino's destination. Trails records arrive after Trails-owned redaction, retain their category and timestamp as structured fields, and map `trace` through `fatal` directly to Pino levels. `silent` records do not reach Pino.

## Installation

These commands target stable `0.2.0`. Run them after that version is published to npm.

```bash
bun add --exact @ontrails/observability@0.2.0 @ontrails/pino@0.2.0
```

## Migration

This package is the final Pino adapter in the pre-v1 hard cut. No compatibility subpath remains; see the logging migration guide for the explicit historical import map.
