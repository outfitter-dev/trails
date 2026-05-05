---
'@ontrails/core': minor
'@ontrails/cli': minor
---

Project typed-layer `input` schemas onto CLI flags. Each effective layer (topo + surface + trail composition order) with a non-undefined `input` schema gets its fields auto-derived into `--flag` options on every command it attaches to. Parsed values route to the layer at runtime via `ctx.extensions[LAYER_INPUTS_KEY][layer.name]` — `Layer.wrap` is unchanged. Collision rule: if a layer field name collides with a trail input field, another layer's projected name, or a CLI meta flag, the layer's flag is renamed to `--<layer-name>-<original-flag-name>` and a one-line warning emits to stderr (`[trails] ...`). Renames are deterministic across builds. New `LAYER_INPUTS_KEY` (exported from `@ontrails/core`) reserves the `ctx.extensions` slot.
