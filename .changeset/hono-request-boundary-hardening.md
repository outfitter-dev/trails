---
"@ontrails/hono": patch
---

Harden the Hono surface by capping JSON request bodies at 1 MiB by default and
redacting generic internal errors while preserving server-side diagnostics.
