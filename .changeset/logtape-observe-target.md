---
"@ontrails/logging": patch
"@ontrails/logtape": major
---

Retarget the LogTape adapter to `@ontrails/observe` log sink types and use `createLogtapeSink` as the canonical factory name.
Refresh the legacy logging README's LogTape forwarding example while the package remains present on the intermediate stack branch.
