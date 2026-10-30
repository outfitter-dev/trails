---
'@ontrails/rpc': minor
---

Add `@ontrails/rpc`, the host-agnostic JSON-RPC 2.0 surface kernel: `deriveRpcMethods(graph)` renders trail ids as methods with schemas, examples and layer inputs, and `createRpcHandler(graph, options)` maps serializable connection state plus one inbound frame to outbound frames and effects. Trails run through the shared pipeline; failures carry core's JSON-RPC codes and `data.category`, `data.retryable`, `data.name`. `trails.discover` is the first `trails.*` method; subscription, progress, input and auth methods wait for their host and ADR gates.
