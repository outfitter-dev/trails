---
"@ontrails/warden": patch
---

Warn when a `resource('id', { ... })` definition declares neither a `mock` factory nor an explicit `unmockable` reason, so `testAll(app)` can provision it without production configuration (common pitfall #10).
