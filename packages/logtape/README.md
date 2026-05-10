# @ontrails/logtape

LogTape adapter for `@ontrails/observe`.

Use `createLogtapeSink(...)` when you already have a LogTape-shaped logger and
want Trails log records to flow into it:

```typescript
import { getLogger } from '@logtape/logtape';
import { createLogtapeSink } from '@ontrails/logtape';

const sink = createLogtapeSink({ logger: getLogger('app') });
```

The package does not depend on `@logtape/logtape`; it accepts any object shaped
like a LogTape logger through `LogtapeLoggerLike`.
