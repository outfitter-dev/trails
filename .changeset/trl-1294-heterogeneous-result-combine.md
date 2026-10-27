---
"@ontrails/core": patch
---

Preserve heterogeneous tuple success positions, readonly/mutable tuple modifiers, and error unions in `Result.combine()`. Typed `ctx.compose()` batches can now be combined directly without casts. Synchronous first-error-by-input-order behavior and homogeneous array support are unchanged (TRL-1294).
