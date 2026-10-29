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
- The WebSocket `surface()` entry arrives with the Bun host as its own subpath export; nothing in this package opens a connection.

## Protocol

Full JSON-RPC 2.0: batches, notifications, request and response correlation, and the reserved `rpc.` prefix (answered with method-not-found). One frame carries one message or one batch; parse failures and empty batches answer with a single null-id error.

Per-request framework fields ride in `params._meta`: `version` selects a trail version, `idempotencyKey` is reserved for the retry-safe write path. Typed layer inputs ride in `params` under their rendered field names, using the same collision policy as the MCP rendering.

`trails.discover` returns the protocol version, the host capabilities the kernel was created with, the implemented `trails.*` methods, the trails the connection permit allows (schemas, examples, intent) and the topo's signal ids. Subscription, input and auth methods are not advertised until a host implements them.

`trails.cancel` (`{ id }`) aborts an in-flight request on the same connection through `ctx.abortSignal`; cancellation handles live only in the host process, so after a wake there is nothing to cancel and `recover` has already answered the id.

`trails.progress` is a server-to-client notification `{ id, event }` bridged from `ctx.progress`. It is emitted only when the host declared `capabilities.progress` and passed a `send` seam to `run` or `handle`; a host that cannot push omits both and the method is not advertised.

## State and effects

`RpcConnectionState` is plain data: protocol version, the permit the host resolved before upgrade, and in-flight request ids. Effects are plain data too (today only `close`), so a Bun host can keep state in memory while a hibernatable host persists it. Trail logic never sees RPC or WebSocket types.
