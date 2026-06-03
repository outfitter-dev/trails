---
"@ontrails/warden": patch
"@ontrails/trails": patch
---

Add a Warden rule (`no-destructured-compose`) that coaches trail blazes to call `ctx.compose(...)` directly instead of destructuring `compose` from the context.

Keep the generated `create` trail on the direct `ctx.compose(...)` shape so framework-authored trails follow the same composition guidance.
