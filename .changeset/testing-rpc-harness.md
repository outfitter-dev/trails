---
'@ontrails/testing': minor
---

Add `@ontrails/testing/rpc` with `createRpcHarness`: an in-process harness over the `@ontrails/rpc` kernel (one connection, serializable state kept between calls) so tests can call trails as JSON-RPC methods, read core error facts, observe `trails.discover` and pushed progress, and seed the connection permit without opening a socket. `@ontrails/rpc` is an optional peer, like the other surface harnesses.
