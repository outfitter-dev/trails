---
'@ontrails/core': patch
'@ontrails/observe': patch
'@ontrails/tracing': patch
---

Promote signal trace helpers from tracing compatibility code to core exports, and make tracing's memory sink wrapper use the observe-owned implementation.
