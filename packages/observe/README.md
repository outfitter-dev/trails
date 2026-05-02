# @ontrails/observe

Primitive observability contracts for Trails.

This package is the public home for log and trace sink shapes used by Trails
apps and connectors. It includes zero-dependency sinks for local and server
baselines, plus connector composition for production observability.

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
rotation or a production connector when retention policy matters.
