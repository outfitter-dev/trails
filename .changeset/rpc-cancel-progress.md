---
'@ontrails/rpc': minor
---

Add `trails.cancel` and `trails.progress` to the RPC kernel. `trails.cancel` aborts an in-flight request on the same connection through `ctx.abortSignal`; `trails.progress` bridges `ctx.progress` to a server-to-client notification when the host declares the `progress` capability and passes a `send` seam to `run` or `handle`. Connection state now carries a `connectionId`.
