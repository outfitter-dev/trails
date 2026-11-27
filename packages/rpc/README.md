# @ontrails/rpc

Host-agnostic JSON-RPC 2.0 surface kernel. A trail id is the method name, `params` is the trail input, and failures carry core's JSON-RPC codes with `data.category`, `data.retryable` and `data.name`. Hosts (the Bun WebSocket host, a Durable Object, a stdio bridge) own connections; this package owns the protocol.

## Usage

```typescript
import { Result, topo, trail } from '@ontrails/core';
import { createRpcHandler } from '@ontrails/rpc';
import { z } from 'zod';

const greet = trail('greet', {
  implementation: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
});

const handler = createRpcHandler(topo('app', { greet })).unwrap();
const state = handler.createState();
const step = await handler.handle(
  state,
  '{"jsonrpc":"2.0","id":1,"method":"greet","params":{"name":"Ada"}}'
);
// step.frames[0] → { jsonrpc: '2.0', id: 1, result: { greeting: 'Hello, Ada!' } }
```

## The derive, create ladder

- `deriveRpcMethods(graph, options)` returns the method and channel table as a `Result` without opening anything. It uses the shared surface selection grammar (`include`, `exclude`, `intent`, visibility, `_draft.` exclusion) and rejects any trail id under the reserved `trails.` or `rpc.` prefixes.
- `createRpcHandler(graph, options)` returns the kernel. `admit(state, frame)` parses and validates one inbound frame and records request ids as in flight; `run(state, work)` executes it; `handle` does both; `recover(state)` answers ids still in flight after a wake with `data.outcome: 'unknown'` and never re-runs them.
- `surface(graph, options)` from `@ontrails/rpc/websocket` starts `Bun.serve` with the upgrade on `/rpc` (configurable) and returns `{ url, close }`; `createRpcWebSocketHost(graph, options)` returns `{ upgrade, websocket, drain }` to attach to a server you already run. The package root never opens a connection.

## Protocol

Full JSON-RPC 2.0: batches, notifications, request and response correlation, and the reserved `rpc.` prefix (answered with method-not-found). One frame carries one message or one batch; parse failures and empty batches answer with a single null-id error.

Per-request framework fields ride in `params._meta`: `version` selects a trail version, `idempotencyKey` is reserved for the retry-safe write path. Typed layer inputs ride in `params` under their rendered field names, using the same collision policy as the MCP rendering.

`trails.discover` returns the protocol version, the host capabilities the kernel was created with, the implemented `trails.*` methods, the trails the connection permit allows (schemas, examples, intent) and the topo's signal ids. Subscription, input and auth methods are not advertised until a host implements them.

`trails.cancel` (`{ id }`) aborts an in-flight request on the same connection through `ctx.abortSignal`; cancellation handles live only in the host process, so after a wake there is nothing to cancel and `recover` has already answered the id.

`trails.progress` is a server-to-client notification `{ id, event }` bridged from `ctx.progress`. It is emitted only when the host declared `capabilities.progress` and passed a `send` seam to `run` or `handle`; a host that cannot push omits both and the method is not advertised.

## State and effects

`RpcConnectionState` is plain data: protocol version, the permit the host resolved before upgrade, and in-flight request ids. Effects are plain data too (today only `close`), so a Bun host can keep state in memory while a hibernatable host persists it. Trail logic never sees RPC or WebSocket types.

## WebSocket host

Identity resolves before upgrade from the `Authorization` header through `resolvePermit` (same input shape as the HTTP surface); cookies and admission tickets arrive with the auth lane. The 101 selects exactly `trails.v1`. One JSON-RPC message or batch rides per text frame; binary frames and a missing subprotocol close `1002`.

Close codes cover connection-level failures only; trail failures stay JSON-RPC errors on the open socket:

| Code | When |
| --- | --- |
| 1000 | Normal close, including client hangup |
| 1001 | Server draining, after a `trails.draining` notification |
| 1002 | Binary frame or wrong subprotocol |
| 1008 | Authentication or policy failure at upgrade |
| 1009 | Frame over `maxFrameBytes` (default 1 MiB) |
| 1011 | Internal failure in the connection kernel |
| 1013 | Buffered outbound bytes past `backpressureHardLimitBytes` (default 16 MiB) |

`close()` on the surface result drains every socket and waits (up to one second by default) for the close handshakes before stopping the server, so clients receive `trails.draining` and 1001 rather than an abnormal close. `resolvePermit` runs for every upgrade: answer `null` for credential absence so anonymous clients keep public trails, and return an error only for a presented credential that fails verification. Progress notifications are pushed through the socket; subscriptions, `trails.auth` refresh and the soft backpressure threshold wait for the durable subscription work.

## Conformance

`@ontrails/rpc/testing` exports `createRpcConformanceCases()` and `runRpcConformance(host)`, mirroring the HTTP adapter conformance precedent. A host implements `RpcConformanceHost` (start a server for a topo, open a connection, drain, close) and every host runs the same cases: trail invocation with the same error facts as HTTP, batches and the reserved `rpc.` prefix, permit-scoped discovery, identity before upgrade, cancel, progress, the close-code map, reserved-prefix rejection, and in-flight recovery. The Bun WebSocket host runs the suite in this package; the Cloudflare host imports the same cases without Bun-specific assumptions. A host that cannot push declares `pushes: false` and the progress case asserts silence instead. The in-flight recovery case is kernel-level (wake paths are host-specific); hosts with a wake add their own test on top. Subscription cases extend the suite when durable subscriptions land.
