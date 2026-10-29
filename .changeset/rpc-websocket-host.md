---
'@ontrails/rpc': minor
---

Add `@ontrails/rpc/websocket`, the Bun WebSocket host for the RPC kernel: `surface(graph, options)` starts `Bun.serve` with the upgrade on `/rpc`, and `createRpcWebSocketHost` returns the `upgrade` and `websocket` pieces to attach to an existing server. Identity resolves before upgrade from `Authorization`, the socket negotiates exactly `trails.v1`, one JSON-RPC message or batch rides per text frame, and connection failures use the documented close codes (1001 draining after `trails.draining`, 1002 protocol, 1008 policy, 1009 size, 1011 internal, 1013 backpressure).
