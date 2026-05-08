# @ontrails/bun

Bun.serve adapter for Trails. Use this package when you want to serve a topo over HTTP with Bun's native server while keeping `@ontrails/http` focused on framework-agnostic route building.

## Usage

```typescript
import { surface } from '@ontrails/bun';
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

For lower-level adapter wiring, derive routes with `@ontrails/http` and pass
them to your own `Bun.serve` invocation:

```typescript
import { createApp } from '@ontrails/bun';
import { graph } from './app';

const handler = createApp(graph);

Bun.serve({
  error: handler.onError,
  fetch: handler.fetch,
  port: 3000,
  routes: handler.routes,
});
```

## Installation

```bash
bun add @ontrails/http @ontrails/bun
```

## Versus @ontrails/hono

Both packages adapt `HttpRouteDefinition[]` from `@ontrails/http` onto an HTTP
runtime. `@ontrails/hono` wraps Hono in front of `Bun.serve`, which keeps the
deployment story portable across Workers, Deno, and Node. `@ontrails/bun` skips
Hono and registers routes directly on `Bun.serve`'s native routes API. Use
`@ontrails/hono` when runtime portability matters; use `@ontrails/bun` when the
target is Bun and you want the smaller dependency tree.

## Webhook trails

Webhook input source (`inputSource: 'webhook'`) is not supported in v0.
`createApp()` throws `ValidationError` at build time when any webhook trail is
present, naming the offending trail. This is a deliberate loud-error posture
rather than a silent runtime 501. Use `@ontrails/hono` if you have webhook
trails today; this adapter will ship webhook support in a follow-up.

## Bun version

Requires Bun 1.2.3 or newer. Uses `Bun.serve`'s native routes API.
