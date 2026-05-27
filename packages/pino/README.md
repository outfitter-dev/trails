# @ontrails/pino

Pino adapter package for `@ontrails/observe`.

## Installation

```bash
bun add @ontrails/observe @ontrails/pino pino
```

`pino` is supplied by your application. `@ontrails/pino` has no hard runtime dependency on it.

## Usage

Use `createPinoSink(...)` when you already have a Pino-shaped logger and want Trails log records to flow into it:

```typescript
import pino from 'pino';
import { createPinoSink } from '@ontrails/pino';

const sink = createPinoSink(pino());
```

The package does not depend on `pino`; it accepts any object shaped like a Pino logger through `PinoLoggerLike`. Records are forwarded in Pino's object-first style as `logger.info(payload, message)`, preserving the metadata already redacted by Trails.

```typescript
import pino from 'pino';
import { topo } from '@ontrails/core';
import { createPinoSink } from '@ontrails/pino';

const logger = pino();
// trails is your application's array of Trail definitions.
const graph = topo('app', trails, {
  observe: {
    log: createPinoSink(logger),
  },
});
```

## Structural Logger Shape

`PinoLoggerLike` requires `trace`, `debug`, `info`, `warn`, `error`, and `fatal` methods that accept `(payload, message)`. The sink forwards:

- `record.message` as the Pino message argument.
- `record.category`, `record.timestamp`, and `record.metadata` in the payload.
- `silent` records as no-ops.

If a required method is missing at runtime, the sink throws instead of silently dropping the record.

## Publishing

`@ontrails/pino` participates in the standard Trails package publish checks:

```bash
bun run publish:check
bun run publish:registry-check
```

`publish:registry-check` is read-only. Before the first registry publication it may report `@ontrails/pino` as a first-time package candidate. Actual package publication still goes through the repo script:

```bash
bun run publish:packages
```

Do not publish this package with `npm publish` or `changeset publish`.
