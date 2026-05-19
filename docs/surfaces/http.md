# HTTP Surface

The HTTP surface turns every exposed trail into a route. Routes are derived from trail IDs, HTTP verbs from intent, input parsing from the method, and error responses from the error taxonomy.

The package separates framework-agnostic route building (`@ontrails/http`), shared Web Fetch request handling (`@ontrails/http/fetch`), the Hono adapter (`@ontrails/hono`), and Bun-native serving (`@ontrails/http/bun`).

## Setup

```bash
bun add @ontrails/http @ontrails/hono
```

```typescript
import { surface } from '@ontrails/hono';
import { graph } from './app';

await surface(graph, { port: 3000 });
```

That starts an HTTP server with every exposed trail registered as a route.

For Bun-native serving without Hono:

```bash
bun add @ontrails/http
```

```typescript
import { surface } from '@ontrails/http/bun';
import { graph } from './app';

await surface(graph, { port: 3000 });
```

`@ontrails/hono` is the portable Hono integration. `@ontrails/http/bun` uses
Bun's native `routes` fast path, keeps a Fetch fallback for unmatched requests,
and adds no third-party HTTP framework dependency.

## Projection and runtime materialization

HTTP follows the surface naming split:

- `deriveHttpRoutes()` and `deriveOpenApiSpec()` are `derive*` projections from
  the topo. They do not open a server.
- `createRouteHandler()` and `createFetchHandler()` from
  `@ontrails/http/fetch` are `create*` runtime materializers. They return Web
  Standard `Request` -> `Response` handlers without listening on a port.
- `surface()` opens the boundary: `@ontrails/hono` starts Hono;
  `@ontrails/http/bun` starts `Bun.serve()`.

The shared Fetch kernel owns query/body parsing, content-length validation,
public error projection, diagnostics, request ID/header forwarding, abort
propagation, and webhook verification/parsing. Hono and Bun consume the same
kernel so those behaviors stay in parity.

## How Trail IDs Map to Routes

Dots in trail IDs become path segments:

| Trail ID       | Route path        |
| -------------- | ----------------- |
| `greet`        | `/greet`          |
| `entity.show`  | `/entity/show`    |
| `entity.add`   | `/entity/add`     |
| `math.add`     | `/math/add`       |

A `basePath` option prepends a prefix to all routes:

```typescript
await surface(graph, { basePath: '/api/v1', port: 3000 });
// entity.show -> /api/v1/entity/show
```

## Intent to HTTP Verb Mapping

The trail's `intent` determines which HTTP method the route uses:

| Intent      | HTTP Method | Rationale                          |
| ----------- | ----------- | ---------------------------------- |
| `read`      | GET         | Safe, no side effects              |
| `destroy`   | DELETE      | Irreversible removal               |
| *(default)* | POST        | Mutations, creates, general writes |

If no intent is declared, the trail defaults to POST.

## Input Handling

Input parsing depends on the HTTP method:

- **GET** -- Query parameters are parsed into an object. Repeated keys become arrays; single keys stay strings. The trail's input schema owns any coercion.
- **POST / DELETE** -- The JSON request body is parsed via `req.json()`.
- **Webhook routes** -- The shared Fetch kernel reads the raw body first, runs the webhook `verify` hook if one is defined, parses JSON, then validates the parsed payload against the source's `parse` schema before executing the trail.

For direct routes, the parsed input is validated against the trail's Zod schema before the blaze receives it. For webhook routes, the source `parse` schema validates the JSON payload first, then the receiving trail's `input` schema validates the value passed into the trail.

## Webhook Activation Sources

Webhook activation is declared in core with `webhook()` and materialized by the HTTP surface. The source is provider-agnostic: Stripe, GitHub, Slack, or an internal webhook adapter should all produce the same universal source shape instead of inventing provider-specific activation kinds.

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  getWebhookHeader,
  PermissionError,
  Result,
  topo,
  trail,
  webhook,
} from '@ontrails/core';
import { z } from 'zod';

const paymentReceived = webhook('webhook.payment.received', {
  path: '/webhooks/payment',
  parse: z.object({
    amount: z.number(),
    paymentId: z.string(),
  }),
  verify: (request) => {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    const signature = getWebhookHeader(request, 'x-payment-signature');
    if (secret === undefined || signature === undefined) {
      return Result.err(new PermissionError('Invalid webhook signature'));
    }
    // Compute the expected HMAC over the raw body and compare in
    // constant time. `timingSafeEqual` requires equal-length buffers,
    // so guard the length before calling it.
    const body =
      typeof request.body === 'string'
        ? Buffer.from(request.body, 'utf8')
        : Buffer.from(request.body);
    const expected = createHmac('sha256', secret).update(body).digest();
    // Validate the hex format strictly before decoding. `Buffer.from(_, 'hex')`
    // silently truncates invalid or odd-length input rather than throwing,
    // which could let a malformed signature decode to bytes that pass
    // `timingSafeEqual`. Require an even-length string of hex characters.
    if (signature.length === 0 || signature.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(signature)) {
      return Result.err(new PermissionError('Invalid webhook signature format'));
    }
    const received = Buffer.from(signature, 'hex');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return Result.err(new PermissionError('Invalid webhook signature'));
    }
    return Result.ok();
  },
});

const receivePayment = trail('payment.receive', {
  blaze: async (input) => Result.ok({ recorded: input.paymentId }),
  input: z.object({
    amount: z.number(),
    paymentId: z.string(),
  }),
  on: [paymentReceived],
  output: z.object({ recorded: z.string() }),
});

export const graph = topo('billing', { receivePayment });
```

When `surface(graph)` runs, the source above becomes `POST /webhooks/payment`. A `method` field can opt into `GET`, `PUT`, `PATCH`, `POST`, or `DELETE`; `POST` is the default.

The `parse` schema describes the payload after JSON parsing and before the trail runs. Its output must be compatible with the receiving trail's `input` schema. The optional `verify` hook receives the raw body plus request headers, method, and path so signature checks can run before JSON parsing changes the bytes being signed.

Provider adapter helpers should wrap this shape, not replace it:

```typescript
export const stripePaymentSucceeded = webhook(
  'webhook.stripe.payment-succeeded',
  {
    path: '/webhooks/stripe',
    parse: stripePaymentSucceededPayload,
    verify: verifyStripeSignature,
  }
);
```

Route collision handling is explicit. If two webhook sources claim the same method and path, or a webhook source collides with a derived direct trail route such as `trail('webhooks.payment', ...)`, `deriveHttpRoutes()` returns a `ValidationError` and Warden reports `webhook-route-collision`.

## Response Format

### Success

```json
{
  "data": { "name": "Alpha", "type": "concept", "tags": ["core"] }
}
```

HTTP 200 for all successful responses.

### Error

```json
{
  "error": {
    "message": "Entity not found: Omega",
    "code": "NotFoundError",
    "category": "not_found"
  }
}
```

The `code` is the error class name. The `category` matches the error taxonomy.
HTTP bodies use the shared public error projection: `TrailsError` messages are
redacted before they are returned, internal-category errors are made opaque, and
unknown native errors are reported as `InternalError` with `Internal server
error`.

## Status Code Mapping

Status codes come directly from the error taxonomy -- the same mapping used across all surfaces:

<!-- error-taxonomy:start -->
<!-- GENERATED: run `bun run error-taxonomy:sync`; check with `bun run error-taxonomy:check`. Variant: http. -->

| Category | HTTP Status | Retryable | Fixed Classes |
| --- | --- | --- | --- |
| `validation` | 400 | No | `ValidationError`, `AmbiguousError` |
| `not_found` | 404 | No | `NotFoundError` |
| `conflict` | 409 | No | `AlreadyExistsError`, `ConflictError` |
| `permission` | 403 | No | `PermissionError`, `PermitError` |
| `timeout` | 504 | Yes | `TimeoutError` |
| `rate_limit` | 429 | Yes | `RateLimitError` |
| `network` | 502 | Yes | `NetworkError` |
| `internal` | 500 | No | `AssertionError`, `InternalError`, `DerivationError`, `RecoverableCompletionError` |
| `auth` | 401 | No | `AuthError` |
| `cancelled` | 499 | No | `CancelledError` |

Dynamic classes:

- `RetryExhaustedError` inherits category and surface codes from its wrapped `TrailsError`; retryable is always No.
<!-- error-taxonomy:end -->

Unrecognized errors (non-`TrailsError` exceptions) return 500 with `category: 'internal'`.

## Execution Layers

HTTP accepts execution layers in the surface options. They wrap trail execution
for requests on that surface before execution enters the blaze; they are not declared on the topo
or surfaced as contract graph nodes in v1.

```typescript
import { surface } from '@ontrails/hono';
import { loggingLayer, rateLimitLayer } from './layers';

await surface(graph, {
  layers: [loggingLayer, rateLimitLayer],
  port: 3000,
});
```

Layers run in order, wrapping trail execution. They have access to the trail and its context, so they can inspect intent, metadata, and markers.

## CreateAppOptions

`surface(graph, options)` and `createApp(graph, options)` share the same
options bag. The most useful fields are:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `basePath` | `string` | `''` | Prefix for all derived route paths |
| `configValues` | `Record<string, Record<string, unknown>>` | *none* | Resource config values keyed by resource ID |
| `createContext` | `() => TrailContextInit \| Promise<TrailContextInit>` | default context | Factory for per-request TrailContext init data |
| `exclude` | `readonly string[]` | *none* | Exclude matching trail IDs from the surface |
| `hostname` | `string` | `'0.0.0.0'` | Bind address used by `surface()` |
| `include` | `readonly string[]` | *none* | Narrow the surface to matching trail IDs |
| `intent` | `readonly Intent[]` | *none* | Filter exposed trails by intent |
| `layers` | `readonly Layer[]` | `[]` | Execution layers to compose around blazes |
| `name` | `string` | *none* | Accepted but currently unused — reserved for future use |
| `port` | `number` | `3000` | Listen port used by `surface()` |
| `resources` | `ResourceOverrideMap` | *none* | Explicit resource instances for this surface |
| `validate` | `boolean` | `true` | Set to `false` to skip topo validation at startup |

## Request ID Bridging

The handler reads `X-Request-ID` from inbound requests and passes it through to the `TrailContext`. If no header is present, the context's default ID is used.

## Escape Hatch

For custom setups, use `@ontrails/http/fetch` when you want Trails to keep
owning the request/response semantics and your runtime to own the server:

```typescript
import { createFetchHandler } from '@ontrails/http/fetch';

const fetch = createFetchHandler(graph, { basePath: '/api' });

export default {
  fetch,
};
```

If your framework needs route-by-route registration, combine
`deriveHttpRoutes()` with `createRouteHandler()`:

```typescript
import { deriveHttpRoutes } from '@ontrails/http';
import { createRouteHandler } from '@ontrails/http/fetch';
import { Hono } from 'hono';

const hono = new Hono();
const routesResult = deriveHttpRoutes(graph, { basePath: '/api' });

if (routesResult.isErr()) {
  throw routesResult.error; // ValidationError if route collisions are detected
}

for (const route of routesResult.value) {
  const handler = createRouteHandler(route);
  hono.on(route.method, route.path, (c) => handler(c.req.raw));
}

export default hono;
```

This gives you full control over the HTTP framework while preserving the shared query/body parsing, error projection, diagnostics, abort propagation, and webhook behavior.

`deriveHttpRoutes()` returns `Result<HttpRouteDefinition[], Error>`. If two trails resolve to the same method + path (e.g. two trails both map to `POST /entity/add`), it returns a `ValidationError` describing the collision instead of silently overwriting a route.

## Request Context and AbortSignal Propagation

The HTTP request's abort signal is forwarded to `TrailContext.abortSignal`. If the client disconnects or cancels the request mid-flight, the trail's blaze sees the aborted signal. Pass request headers as the fourth `execute` argument when the HTTP surface should resolve Bearer credentials into `ctx.permit`.

```typescript
const longTask = trail('report.generate', {
  blaze: async (input, ctx) => {
    for (const chunk of data) {
      if (ctx.abortSignal?.aborted) {
        return Result.err(new CancelledError('Request cancelled'));
      }
      await processChunk(chunk);
    }
    return Result.ok({ report: '...' });
  },
});
```

## Example: Full HTTP Entry Point

```typescript
import { createTrailContext } from '@ontrails/core';
import { surface } from '@ontrails/hono';
import { graph } from './app';
import { createStore } from './store';

const store = createStore([
  { name: 'Alpha', tags: ['core'], type: 'concept' },
]);

await surface(graph, {
  createContext: () => createTrailContext({ store }),
  port: 3000,
});
```

```bash
curl http://localhost:3000/entity/show?name=Alpha
# {"data":{"name":"Alpha","type":"concept","tags":["core"]}}

curl -X POST http://localhost:3000/entity/add \
  -H 'Content-Type: application/json' \
  -d '{"name":"Delta","type":"tool"}'
# {"data":{"name":"Delta","type":"tool","tags":[]}}
```
