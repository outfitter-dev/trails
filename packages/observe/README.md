# @ontrails/observe

Primitive observability contracts for Trails.

This package is the public home for log and trace sink shapes used by Trails
apps and connectors. The initial surface re-exports the core contracts; runtime
sink helpers are added in focused follow-up branches.

```typescript
import { combine } from '@ontrails/observe';

const sink = combine(otelSink, fileSink);
```
