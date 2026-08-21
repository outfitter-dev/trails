# @ontrails/config

Schema-derived configuration for Trails.

The root package owns the runtime-agnostic config declaration and resolution engine. Schemas define the contract, and `configResource` exposes resolved values to trail execution.

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
  implementation: (_input, ctx) => {
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

`appConfig()` discovers `*.config.toml`, `*.config.json`, `*.config.jsonc`, and `*.config.yaml` by default, plus dotfile equivalents when `dotfile: true`.

## Trails project roots

`@ontrails/config` owns the shared project-root convention helpers used by framework tools. `resolveTrailsProjectRoot()` honors an explicit root first, then walks upward from a start directory looking for committed project markers:

- `trails.config.ts`, `.mts`, `.js`, `.mjs`, `.json`, `.jsonc`,
  `.yaml`, or `.toml`
- `trails.lock`
- source-shaped projects with `src/trails/` or `trails/` when no committed marker exists above them

`trails.config.local.*` is a per-developer override and does not mark a project root by itself. A bare `.trails/` directory also does not mark a root; it is the committed-control home for project-local sections after a project root is known.

## Workspace app identity

A workspace root names its lock-owning Trails apps in the static `workspace.apps` section. App IDs are the authored identity, roots are project-relative, and an `entry` override is app-root-relative. Omit `entry` when the app uses the shared `src/app.ts` convention:

```typescript
import { defineConfig } from '@ontrails/config';
import { z } from 'zod';

export default defineConfig({
  schema: z.object({}),
  workspace: {
    apps: {
      demo: { root: 'apps/demo' },
      junction: { root: 'examples/junction' },
      custom: { root: 'apps/custom', entry: 'src/custom-app.ts' },
    },
  },
});
```

A workspace-only root may use a direct object without inventing a deployment schema:

```typescript
export default {
  workspace: {
    apps: {
      demo: { root: 'apps/demo' },
    },
  },
};
```

`readTrailsProjectIdentity()` reads only this literal project-identity subset. TypeScript modules are parsed without being imported or evaluated; JSON, JSONC, YAML, and TOML configs converge through the same validator. Dynamic app declarations, escaping paths, normalized root collisions, and nested workspace declarations fail with typed `ValidationError` diagnostics.

Callers must supply their collection boundary; Config does not infer a working-tree boundary. Pass `startDir` as well when discovery starts below that root. Discovery walks past app-local locks and ordinary nested app configs, inventories workspace declarations throughout the collection, and never crosses the supplied boundary or a nested repository edge:

```typescript
import { readTrailsProjectIdentity } from '@ontrails/config';

const workspaceRoot = '/path/to/workspace';
const identity = await readTrailsProjectIdentity({
  boundaryDir: workspaceRoot,
  startDir: process.cwd(),
});
```

Each resolved app preserves the app-relative `entry` and derives its project-relative `modulePath`, absolute `rootDir` and `entryPath`, and whether the entry came from convention or an explicit override. Only authored IDs, roots, and optional entry overrides are project identity; absolute paths are live convenience values.

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
import { env, secret } from '@ontrails/config';

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
  implementation: (_input, ctx) => {
    const state = configResource.from(ctx);
    return Result.ok(state.resolved);
  },
});
```

## Trail definitions

### `config.check`

Validate config values against the schema. Returns a config report with field-level status (valid, missing, invalid, deprecated, default) and the checked field values when available.

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

const results = testAll(graph);
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
