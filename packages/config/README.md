# @ontrails/config

Schema-derived configuration for Trails.

The root package owns the connector-agnostic config declaration and resolution engine. Schemas define the contract; the resource and layer bind resolved values to the execution context.

## The core pattern

### 1. Define the config schema

```typescript
import { defineConfig, env, secret } from '@ontrails/config';
import { z } from 'zod';

export const config = defineConfig({
  schema: z.object({
    port: z.number().default(3000),
    host: z.string().default('localhost'),
    database: z.object({
      url: env(secret(z.string()), 'DATABASE_URL'),
    }),
    debug: z.boolean().default(false),
  }),
  base: {
    host: 'example.com',
  },
  profiles: {
    production: {
      debug: false,
      host: 'prod.example.com',
      port: 443,
    },
    test: {
      debug: true,
      port: 0,
    },
  },
});
```

### 2. Resolve the config at bootstrap

```typescript
import { registerConfigState } from '@ontrails/config';

const result = await config.resolve({
  cwd: process.cwd(),
  profile: process.env.TRAILS_ENV,
});

if (!result.isOk()) {
  throw result.error;
}

registerConfigState({
  resolved: result.unwrap(),
  schema: config.schema,
  base: config.base,
  profile: process.env.TRAILS_ENV,
  env: process.env,
});
```

### 3. Access resolved config in trails

```typescript
import { configResource } from '@ontrails/config';

export const getStatus = trail('status.get', {
  resources: [configResource],
  blaze: (_input, ctx) => {
    const state = configResource.from(ctx);
    return Result.ok({
      port: state.resolved.port,
      debug: state.resolved.debug,
    });
  },
});
```

## Resolution stack

Config resolves through a deterministic priority order:

```text
defaults (schema) → base → profile → local → env
```

Each layer overrides the previous. Environment variables always win.

## Extensions

### `env()`

Bind a schema field to an environment variable:

```typescript
import { env } from '@ontrails/config';

const schema = z.object({
  database: env(z.string(), 'DATABASE_URL'),
  port: env(z.number(), 'PORT').default(3000),
});
```

Environment variables are coerced to the schema type. Apply `env()` before `.default()` so metadata lives on the inner type.

### `secret()`

Mark a schema field as sensitive:

```typescript
import { secret } from '@ontrails/config';

const schema = z.object({
  apiKey: secret(z.string()),
  password: secret(env(z.string(), 'DB_PASSWORD')),
});
```

Secret fields are redacted in explain output, diagnostics, and logs.

### `deprecated()`

Mark a field as deprecated with migration guidance:

```typescript
import { deprecated } from '@ontrails/config';

const schema = z.object({
  oldField: deprecated(z.string(), 'Use newField instead'),
  newField: z.string(),
});
```

## The resource

The config resource manages resolved config lifecycle:

```typescript
import { configResource } from '@ontrails/config';

export const myTrail = trail('my.trail', {
  resources: [configResource],
  blaze: (_input, ctx) => {
    const state = configResource.from(ctx);
    return Result.ok(state.resolved);
  },
});
```

## The layer

The config layer reserves a slot in the execution context for per-trail config validation:

```typescript
import { configLayer } from '@ontrails/config';

export const app = topo('my-app', configModule);
// Register configLayer with your trailhead
```

## Trail definitions

### `config.check`

Validate config values against the schema. Returns diagnostics with field-level status (valid, missing, invalid, deprecated, default).

### `config.describe`

Describe all fields in the schema — paths, types, defaults, env bindings, secret markers, deprecation messages.

### `config.explain`

Show which source won for each config field — defaults, base, profile, local, or env.

### `config.init`

Generate example config files in TOML, JSON, JSONC, or YAML. Optionally writes `.env.example` and `.schema.json`.

## Testing

Trails that depend on `configResource` auto-resolve with a mock when registered in the topo:

```typescript
import { testAll } from '@ontrails/testing';

const results = testAll(app);
// configResource.mock() is called automatically
```

For explicit test setup:

```typescript
import { registerConfigState, clearConfigState } from '@ontrails/config';

afterEach(() => clearConfigState());

test('config trail', async () => {
  registerConfigState({
    resolved: { port: 3000 },
    schema: z.object({ port: z.number() }),
  });
  // ...
});
```

## Installation

```bash
bun add @ontrails/config @ontrails/core zod
```
