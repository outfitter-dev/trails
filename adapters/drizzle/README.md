# @ontrails/drizzle

Drizzle adapter for Trails stores. Use this package to bind a backend-agnostic `store(...)` definition from `@ontrails/store` to a concrete Drizzle runtime.

## Usage

```typescript
import { store } from '@ontrails/store';
import { connectDrizzle } from '@ontrails/drizzle';

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
bun add @ontrails/store @ontrails/drizzle zod
```

## Migration

<!-- warden-ignore-next-line -->
This package replaces the old `@ontrails/store/drizzle` subpath.

<!-- warden-ignore-next-line -->
- Before: `import { connectDrizzle } from '@ontrails/store/drizzle'`
- After: `import { connectDrizzle } from '@ontrails/drizzle'`
