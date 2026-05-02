# HTTP Surface

The HTTP surface connector turns every trail into an endpoint. Routes are derived from trail IDs, HTTP verbs from intent, input parsing from the method, and error responses from the error taxonomy. One `surface()` call starts a Hono server.

The package separates framework-agnostic route building (`@ontrails/http`) from the Hono connector (`@ontrails/hono`).

## Setup

```bash
bun add @ontrails/http @ontrails/hono
```

```typescript
import { surface } from '@ontrails/hono';
import { graph } from './app';

await surface(graph, { port: 3000 });
```

That starts an HTTP server with every trail registered as a route.

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
- **Webhook routes** -- The Hono connector reads the raw body first, runs the webhook `verify` hook if one is defined, parses JSON, then validates the parsed payload against the source's `parse` schema before executing the trail.

For direct routes, the parsed input is validated against the trail's Zod schema before the implementation runs. For webhook routes, the source `parse` schema validates the JSON payload first, then the receiving trail's `input` schema validates the value passed into the trail.

## Webhook Activation Sources

Webhook activation is declared in core with `webhook()` and materialized by the HTTP surface. The source is provider-agnostic: Stripe, GitHub, Slack, or an internal webhook connector should all produce the same universal source shape instead of inventing provider-specific activation kinds.

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

Provider connector helpers should wrap this shape, not replace it:

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

## Status Code Mapping

Status codes come directly from the error taxonomy -- the same mapping used across all surfaces:

| Category     | HTTP Status | Classes                              |
| ------------ | ----------- | ------------------------------------ |
| `validation` | 400         | `ValidationError`, `AmbiguousError`  |
| `not_found`  | 404         | `NotFoundError`                      |
| `conflict`   | 409         | `AlreadyExistsError`, `ConflictError`|
| `permission` | 403         | `PermissionError`                    |
| `timeout`    | 504         | `TimeoutError`                       |
| `rate_limit` | 429         | `RateLimitError`                     |
| `network`    | 502         | `NetworkError`                       |
| `internal`   | 500         | `InternalError`, `DerivationError`, `AssertionError` |
| `auth`       | 401         | `AuthError`                          |
| `cancelled`  | 499         | `CancelledError`                     |

`RetryExhaustedError` wraps another `TrailsError` and uses the wrapped error's category, so its HTTP status varies with the underlying failure.

Unrecognized errors (non-`TrailsError` exceptions) return 500 with `category: 'internal'`.

## Execution Layers

HTTP accepts execution layers in the surface options. They wrap trail
implementations for requests on that surface; they are not declared on the topo
or surfaced as contract graph nodes in v1.

```typescript
import { surface } from '@ontrails/hono';
import { authLayer, loggingLayer } from './layers';

await surface(graph, {
  layers: [loggingLayer, authLayer],
  port: 3000,
});
```

Layers run in order, wrapping the implementation. They have access to the trail and its context, so they can inspect intent, metadata, and markers.

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
| `layers` | `readonly Layer[]` | `[]` | Execution layers to compose around implementations |
| `name` | `string` | *none* | Accepted but currently unused — reserved for future use |
| `port` | `number` | `3000` | Listen port used by `surface()` |
| `resources` | `ResourceOverrideMap` | *none* | Explicit resource instances for this surface |
| `validate` | `boolean` | `true` | Set to `false` to skip topo validation at startup |

## Request ID Bridging

The handler reads `X-Request-ID` from inbound requests and passes it through to the `TrailContext`. If no header is present, the context's default ID is used.

## Escape Hatch

For custom setups, use `deriveHttpRoutes()` from the base package to get framework-agnostic route definitions. Each route has an `execute` function that validates input, composes Layers, and runs the trail -- you wire it into whatever HTTP framework you use:

```typescript
import { isTrailsError, mapSurfaceError } from '@ontrails/core';
import { deriveHttpRoutes } from '@ontrails/http';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const hono = new Hono();
const routesResult = deriveHttpRoutes(graph, { basePath: '/api' });

if (routesResult.isErr()) {
  throw routesResult.error; // ValidationError if route collisions are detected
}

// Project any error onto an HTTP status using the shared error taxonomy.
// `TrailsError` subclasses (validation, auth, permission, internal, ...) get
// the documented status; anything else falls back to 500.
const statusFor = (error: unknown): ContentfulStatusCode =>
  isTrailsError(error)
    ? (mapSurfaceError('http', error) as ContentfulStatusCode)
    : 500;

for (const route of routesResult.value) {
  const method = route.method.toLowerCase() as
    | 'delete'
    | 'get'
    | 'patch'
    | 'post'
    | 'put';
  hono[method](route.path, async (c) => {
    if (route.inputSource === 'webhook') {
      const body = await c.req.text();
      const verified = await route.verifyWebhook?.({
        body,
        headers: Object.fromEntries(c.req.raw.headers),
        method: c.req.method,
        path: new URL(c.req.url).pathname,
      });
      if (verified?.isErr()) {
        // Route through the taxonomy: PermissionError -> 403, AuthError -> 401,
        // wrapped InternalError -> 500, etc.
        return c.json(
          { error: { message: verified.error?.message } },
          statusFor(verified.error)
        );
      }
      let payload: unknown;
      try {
        payload = body.length === 0 ? {} : JSON.parse(body);
      } catch {
        return c.json({ error: { message: 'Invalid JSON in request body' } }, 400);
      }
      const parsed = route.parseWebhookInput?.(payload);
      if (parsed === undefined) {
        return c.json(
          { error: { message: 'Webhook route is missing parse handler' } },
          500
        );
      }
      if (parsed.isErr()) {
        return c.json(
          { error: { message: parsed.error?.message } },
          statusFor(parsed.error)
        );
      }
      const result = await route.execute(parsed.value);
      return result.isOk()
        ? c.json({ data: result.value }, 200)
        : c.json(
            { error: { message: result.error?.message } },
            statusFor(result.error)
          );
    }

    const input =
      route.inputSource === 'query'
        ? Object.fromEntries(new URL(c.req.url).searchParams)
        : await c.req.json();
    const result = await route.execute(input);
    return result.isOk()
      ? c.json({ data: result.value }, 200)
      : c.json(
          { error: { message: result.error?.message } },
          statusFor(result.error)
        );
  });
}

export default hono;
```

This gives you full control over the HTTP framework while still deriving routes from the topo.

`deriveHttpRoutes()` returns `Result<HttpRouteDefinition[], Error>`. If two trails resolve to the same method + path (e.g. two trails both map to `POST /entity/add`), it returns a `ValidationError` describing the collision instead of silently overwriting a route.

## AbortSignal Propagation

The HTTP request's abort signal is forwarded to `TrailContext.abortSignal`. If the client disconnects or cancels the request mid-flight, the implementation's signal is aborted.

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
