---
"@ontrails/core": patch
---

Configure Trails SQLite read and write connections with a busy timeout so concurrent artifact readers and writers wait through transient lock contention instead of failing immediately.
