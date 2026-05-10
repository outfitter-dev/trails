---
"@ontrails/core": patch
"@ontrails/warden": patch
---

Move previously root-exported helper contracts out of `src/internal/*` to stable core module homes, document their public boundary, and guard the public barrel against future internal re-exports.
