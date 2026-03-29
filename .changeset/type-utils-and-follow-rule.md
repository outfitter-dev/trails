---
"@ontrails/core": minor
"@ontrails/warden": minor
---

Type utilities and follow-declarations warden rule.

**core**: Add `TrailInput<T>`, `TrailOutput<T>` utility types and `inputOf()`, `outputOf()` runtime schema accessors.

**warden**: Add `follow-declarations` rule — statically analyzes `ctx.follow()` calls against declared `follow: [...]` arrays. Errors on undeclared calls, warns on unused declarations.
