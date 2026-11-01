# @ontrails/rpc

## 0.3.0

### Minor Changes

- [`c2d7b13`](https://github.com/outfitter-dev/trails/commit/c2d7b1357b1ebad71c206b62ad6b4832db035832): Add `trails.cancel` and `trails.progress` to the RPC kernel. `trails.cancel` aborts an in-flight request on the same connection through `ctx.abortSignal`; `trails.progress` bridges `ctx.progress` to a server-to-client notification when the host declares the `progress` capability and passes a `send` seam to `run` or `handle`. Connection state now carries a `connectionId`.
- [`b7abe65`](https://github.com/outfitter-dev/trails/commit/b7abe65fad49857e86b363df5bbf9ca6fc4eaab3): Add `@ontrails/rpc/testing` with `createRpcConformanceCases` and `runRpcConformance`: one case set every RPC host runs (trail invocation with HTTP-identical error facts, batches and the reserved `rpc.` prefix, permit-scoped `trails.discover`, identity before upgrade, `trails.cancel`, `trails.progress`, the close-code map, reserved-prefix rejection, and in-flight recovery). The Bun WebSocket host runs it.
- [`639b5a2`](https://github.com/outfitter-dev/trails/commit/639b5a2b04be4739713a91ffe9f610f50ed43d1f): Add `@ontrails/rpc`, the host-agnostic JSON-RPC 2.0 surface kernel: `deriveRpcMethods(graph)` renders trail ids as methods with schemas, examples and layer inputs, and `createRpcHandler(graph, options)` maps serializable connection state plus one inbound frame to outbound frames and effects. Trails run through the shared pipeline; failures carry core's JSON-RPC codes and `data.category`, `data.retryable`, `data.name`. `trails.discover` is the first `trails.*` method; subscription, progress, input and auth methods wait for their host and ADR gates.
- [`374f18d`](https://github.com/outfitter-dev/trails/commit/374f18da952beca3a5967780dc848cd9dafb579f): Add `@ontrails/rpc/websocket`, the Bun WebSocket host for the RPC kernel: `surface(graph, options)` starts `Bun.serve` with the upgrade on `/rpc`, and `createRpcWebSocketHost` returns the `upgrade` and `websocket` pieces to attach to an existing server. Identity resolves before upgrade from `Authorization`, the socket negotiates exactly `trails.v1`, one JSON-RPC message or batch rides per text frame, and connection failures use the documented close codes (1001 draining after `trails.draining`, 1002 protocol, 1008 policy, 1009 size, 1011 internal, 1013 backpressure).

### Patch Changes

- [`dffba59`](https://github.com/outfitter-dev/trails/commit/dffba590dc569d1af8e93fe449ee8be8aa6d689e): Require explicitly authored actor evidence on execution permits, retain optional issuer and finite millisecond expiry, and derive collision-free issuer-qualified subject keys. This is a breaking 0.x shape migration: custom adapters, contexts and inline CLI permits must supply `actors`, including `[]` when no acting party is known.
  
  Retain validated JWT attester, expiry and current-first actor chains without inventing actor namespaces or trusting caller provenance. Preserve full permits at existing authentication boundaries and update test factories and generated permit commands.
  
  Carry identity evidence through traces, queries and OTel output. Upgrade version-2 developer trace stores without deleting records; preserve unknown historical actors separately from known empty chains. See the permit identity migration guide for compatibility details.
  
  The RPC conformance suite's shared writer permit now carries `actors: []`, so hosts running `createRpcConformanceCases` need no change.
