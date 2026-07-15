---
'@ontrails/core': patch
'@ontrails/observability': major
'@ontrails/testing': patch
'@ontrails/trails': patch
'@ontrails/warden': patch
'@ontrails/oxlint-plugin': patch
---

Rename the dependency-light observability owner from `@ontrails/observe` to
`@ontrails/observability` as a pre-v1 hard cut. Update dependent packages,
documentation, package discovery, and the governed Regrade route; no
compatibility package or old import route is retained.
