---
'@ontrails/adapter-kit': patch
'@ontrails/core': patch
'@ontrails/regrade': patch
'@ontrails/trails': patch
'@ontrails/warden': patch
---

Export a shared `escapeRegExp` helper from core and migrate first-party callers off local copies.
