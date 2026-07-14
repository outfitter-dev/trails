---
'@ontrails/core': patch
'@ontrails/observability': major
'@ontrails/trails': patch
'@ontrails/warden': patch
---

Fold the removed `@ontrails/tracing` package into the truthful existing
owners: intrinsic trace contracts remain in core, developer-state tooling now
lives at `@ontrails/observability/dev`, and the dependency-light OTel adapter
lives at `@ontrails/observability/otel`. There is intentionally no root-package
compatibility redirect because the former root had more than one owner.
