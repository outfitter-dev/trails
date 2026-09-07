---
'@ontrails/pino': patch
---

Treat both `null` and `undefined` Pino flush callback results as success, and verify asynchronous buffered destinations finish writing before the sink resolves.
