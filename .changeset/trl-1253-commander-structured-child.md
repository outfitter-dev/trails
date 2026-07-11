---
"@ontrails/commander": patch
"@ontrails/cli": patch
"@ontrails/trails": patch
---

Keep structured input on nested child commands from being reinterpreted as a
bare child-name positional fallback, while preserving schema-authored
`inputJson` flags as ordinary trail input, including through the public Trails
CLI. Optional numeric flags now consume negative values with Commander's own
parsing semantics, and variadic flags consume every following value, before
nested command routing is resolved.
