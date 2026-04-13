# @ontrails/with-hono

Hono trailhead connector for Trails. Use this package when you want to serve a topo over HTTP with Hono while keeping `@ontrails/http` focused on framework-agnostic route building.

## Usage

```typescript
import { trailhead } from '@ontrails/with-hono';
import { app } from './app';

await trailhead(app, { port: 3000 });
```

For custom HTTP integrations or route inspection, keep using `buildHttpRoutes()` from `@ontrails/http`.

## Installation

```bash
bun add @ontrails/http @ontrails/with-hono
```

## Migration

This package replaces the old `@ontrails/http/hono` subpath.

- Before: `import { trailhead } from '@ontrails/http/hono'`
- After: `import { trailhead } from '@ontrails/with-hono'`
