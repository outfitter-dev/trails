---
'@ontrails/warden': patch
---

`signal-graph-coaching` no longer flags store-derived table signals (`created`/`updated`/`removed`) that have no consumers. Store resources advertise those signals as available capability, so leaving them unconsumed is a legitimate steady state for store-backed apps. Non-store produced signals without consumers still warn, and dead-signal coaching (no producer and no consumer) is unchanged.
