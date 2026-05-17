# @ontrails/pino

Pino adapter package for `@ontrails/observe`.

Use `createPinoSink(...)` when you already have a Pino-shaped logger and want
Trails log records to flow into it:

```typescript
import pino from 'pino';
import { createPinoSink } from '@ontrails/pino';

const sink = createPinoSink(pino());
```

The package does not depend on `pino`; it accepts any object shaped like a Pino
logger through `PinoLoggerLike`. Records are forwarded in Pino's object-first
style as `logger.info(payload, message)`, preserving the metadata already
redacted by Trails.
