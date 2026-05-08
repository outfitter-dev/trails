---
"@ontrails/warden": minor
---

Ship the default `warden` bin from `@ontrails/warden` and migrate the old private `apps/ci` runner into the package-local CLI surface.

The new bin supports `--ci`, `--pre-push`, `--depth`, `--fail-on`, `--strict`, `--format`, `--lock`, `--drafts`, `--apps`, and the Sprint 1 standalone aliases. CI output now uses the package Warden formatters directly, so GitHub annotations and JSON payloads follow the `@ontrails/warden` report shape instead of the retired `apps/ci` wrapper shape.
