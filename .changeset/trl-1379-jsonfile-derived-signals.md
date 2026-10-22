---
'@ontrails/store': patch
---

Emit scoped store-derived created, updated, and removed signals for successful JSON-file mutations through `db.from(ctx)`. Classify changes under the existing table lock, await emission after persistence, and keep failed writes and raw connections silent.
