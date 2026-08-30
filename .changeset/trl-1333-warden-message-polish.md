---
'@ontrails/warden': patch
---

The `resource-id-grammar` diagnostic now serializes its suggested rename with `JSON.stringify`, so the suggested `resource(...)` call stays valid TypeScript even when the resource id contains quote characters.
