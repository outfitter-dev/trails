---
'@ontrails/hono': patch
---

Refactor Hono route handling to delegate Web request parsing, response
projection, diagnostics, permits, and webhook handling through
`@ontrails/http/fetch`.
