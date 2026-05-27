---
"@ontrails/core": patch
---

Fix `ctx.compose(trail, input)` inference for trails that do not define a
`composeInput` schema while preserving authored compose-input requirements.
