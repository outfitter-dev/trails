---
'@ontrails/trails': patch
'@ontrails/warden': patch
---

Promote ADR-0043 (Layer Evolution) from draft to accepted, amend it on 2026-05-04 to remove the briefly proposed `Middleware` split, and publish the Layer Evolution Migration Guide at `docs/migration/layer-evolution.md`.

Documentation-only change capturing the post-implementation state of the layer-evolution work shipped across TRL-471 through TRL-476: typed `Layer` primitive with optional `input` schema, three attachment scopes (trail, surface, topo), CLI/MCP/HTTP surface projection of layer inputs, removal of `authLayer`, `autoIterateLayer`, and `dateShortcutsLayer`, and warden coaching via `no-legacy-layer-imports` (error). The migration guide is the durable countermeasure to the vocabulary churn flagged in ADR-0043's tradeoffs.
