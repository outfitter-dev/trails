---
"@ontrails/topographer": patch
"@ontrails/trails": patch
"@ontrails/wayfinder": patch
---

Make `trails compile` → `trails validate` round-trip deterministically (TRL-1191). The per-user topo store no longer reuses previously stored JSON Schema bytes by zod definition hash — that hash cannot see `.describe()` metadata or object field order, so a warm store could serve pre-edit schema values into a freshly compiled lock and make `validate` report it stale immediately. Every snapshot now regenerates schema JSON from the live Zod schema, the store's graph hash goes through the same shared `deriveStableHash` path as `deriveTopoGraphHash`, and the committed `trails.lock` omits the wallclock `generatedAt` field so recompiling unchanged sources yields a byte-identical lock. `TopoGraph.generatedAt` is now optional; locks written by earlier versions still parse.
