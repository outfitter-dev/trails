---
'@ontrails/trails': patch
---

Fresh app loading now resolves extensionless relative imports the way Bun does at runtime, so runtime-valid apps stay operator-loadable (`trails compile`, `trails warden`, and every other fresh-load path). When a relative import cannot be resolved at all, the failure is an actionable `ValidationError` naming the importer file and specifier instead of an opaque redacted "Internal server error".
