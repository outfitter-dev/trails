---
"@ontrails/core": patch
"@ontrails/cli": patch
"@ontrails/permits": minor
"@ontrails/trails": patch
---

Thread `ResourceSpec.config` through the built-in auth resource. Resource config schemas that accept `undefined` now receive their parsed default when config values are omitted, and `authResource` can materialize the no-op or JWT connector from typed config while preserving existing mock and override paths.
