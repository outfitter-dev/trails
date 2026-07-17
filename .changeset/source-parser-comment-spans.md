---
'@ontrails/source': minor
'@ontrails/warden': patch
---

Expose parser-native comment spans from `parseWithDiagnostics` so source-aware
tooling can distinguish exact JavaScript and TypeScript comment trivia without
reimplementing a lexer.

Use the shared spans in Warden's public-example rule while keeping leading
comment ownership fail-closed across JavaScript line terminators.
