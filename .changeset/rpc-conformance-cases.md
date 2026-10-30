---
'@ontrails/rpc': minor
---

Add `@ontrails/rpc/testing` with `createRpcConformanceCases` and `runRpcConformance`: one case set every RPC host runs (trail invocation with HTTP-identical error facts, batches and the reserved `rpc.` prefix, permit-scoped `trails.discover`, identity before upgrade, `trails.cancel`, `trails.progress`, the close-code map, reserved-prefix rejection, and in-flight recovery). The Bun WebSocket host runs it.
