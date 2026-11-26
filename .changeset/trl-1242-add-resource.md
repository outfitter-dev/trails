---
'@ontrails/trails': minor
---

Add the CLI command `trails add resource <id>` to generate an editable in-memory resource with config-driven creation, lifecycle cleanup, health reporting, and isolated mocks, plus runnable tests. Preserve existing output files and leave topo wiring explicit.

`trails add trail <id>` also rejects existing scaffold destinations before writing instead of overwriting them.
