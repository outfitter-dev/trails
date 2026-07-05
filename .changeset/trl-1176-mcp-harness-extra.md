---
"@ontrails/testing": patch
---

`createMcpHarness` now forwards the full `McpExtra` from `options.extra` — `authorization`, `permit`, and `sessionId` in addition to the already-forwarded `abortSignal`, `progressToken`, and `sendProgress` — so bearer-token permit enforcement can be exercised through the harness instead of invoking `deriveMcpTools` handlers directly (TRL-1176).
