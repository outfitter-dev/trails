# @ontrails/hono

Hono surface connector for Trails. Use this package when you want to serve a topo over HTTP with Hono while keeping `@ontrails/http` focused on framework-agnostic route building.

## Usage

```typescript
import { surface } from '@ontrails/hono';
import { graph } from './app';

await surface(graph, { port: 3000 });
```

JSON request bodies are capped at 1 MiB by default. Override the cap with
`maxJsonBodyBytes` when a surface intentionally accepts larger JSON payloads:

```typescript
await surface(graph, {
  maxJsonBodyBytes: 2 * 1024 * 1024,
  port: 3000,
});
```

Generic non-TrailsError failures return a redacted 500 response while the
original error is written to server diagnostics.

For custom HTTP integrations or route inspection, keep using `deriveHttpRoutes()` from `@ontrails/http`.

## Installation

```bash
bun add @ontrails/http @ontrails/hono
```

## Migration

This package replaces the old `@ontrails/http/hono` subpath.

- Before: `import { trailhead } from '@ontrails/http/hono'`
- After: `import { surface } from '@ontrails/hono'`
