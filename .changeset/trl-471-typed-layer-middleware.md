---
'@ontrails/core': minor
---

Phase 7 starts: typed layers with optional object-shaped surface input. `Layer` gains an optional `input?: LayerInputSchema` field for surface projection (TRL-473/474 will project it onto CLI/MCP/HTTP). `executeTrail({ layers })` remains the canonical per-call wrapper option. Layers without `input` schemas stay surface-invisible and cover runtime-only concerns such as tenant guards, rate limiting, circuit breaking, and custom audit logging.
