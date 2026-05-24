---
"@ontrails/warden": patch
"@ontrails/trails": patch
---

Add a Warden rule that coaches trail blazes to call `ctx.cross(...)` directly instead of destructuring `cross` from the context.

Keep the generated `create` trail on the direct `ctx.cross(...)` shape so framework-authored trails follow the same composition guidance.
