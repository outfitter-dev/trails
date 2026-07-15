# @ontrails/hono

Hono surface adapter for Trails. Use this package when you want to serve a topo over HTTP with Hono while keeping `@ontrails/http` focused on framework-agnostic route building and the shared Web Fetch kernel.

## Usage

```typescript
import { surface } from '@ontrails/hono';
import { graph } from './app';

await surface(graph, { port: 3000 });
```

JSON request bodies are capped at 1 MiB by default. Override the cap with `maxJsonBodyBytes` when a surface intentionally accepts larger JSON payloads:

```typescript
await surface(graph, {
  maxJsonBodyBytes: 2 * 1024 * 1024,
  port: 3000,
});
```

Pass `resolvePermit` to resolve HTTP `Authorization: Bearer ...` credentials into `ctx.permit` before protected trails execute. The adapter forwards request headers to the framework-agnostic HTTP route executor, so malformed Authorization headers return `401` and resolved permits with insufficient scopes return `403`.

Generic non-TrailsError failures return a redacted 500 response while a redacted diagnostic rendering is written to server diagnostics. `TrailsError` responses keep their taxonomy category and class name but redact sensitive message fragments before writing the public body.

For custom HTTP integrations or route inspection, keep using `deriveHttpRoutes()` from `@ontrails/http`. For a framework-neutral runtime handler, use `createRouteHandler()` or `createFetchHandler()` from `@ontrails/http/fetch`. For Bun-native serving without Hono, use `@ontrails/http/bun`.

## Installation

```bash
bun add @ontrails/http@beta @ontrails/hono@beta
```

## Migration

<!-- warden-ignore-next-line -->
This package replaces the old `@ontrails/http/hono` subpath.

<!-- warden-ignore-next-line -->
- Before: `import { trailhead } from '@ontrails/http/hono'`
- After: `import { surface } from '@ontrails/hono'`
