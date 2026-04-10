# @ontrails/with-drizzle

Drizzle connector for Trails stores. Use this package to bind a connector-agnostic `store(...)` definition from `@ontrails/store` to a concrete Drizzle runtime.

## Usage

```typescript
import { store } from '@ontrails/store';
import { connectDrizzle } from '@ontrails/with-drizzle';

const definition = store({
  gists: {
    schema: gistSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
  },
});

export const db = connectDrizzle(definition, {
  id: 'db.main',
  url: ':memory:',
});
```

## Installation

```bash
bun add @ontrails/store @ontrails/with-drizzle zod
```

## Migration

This package replaces the old `@ontrails/store/drizzle` subpath.

- Before: `import { connectDrizzle } from '@ontrails/store/drizzle'`
- After: `import { connectDrizzle } from '@ontrails/with-drizzle'`
