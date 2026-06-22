---
"@ontrails/config": patch
"@ontrails/warden": patch
---

Add shared Trails project-root discovery helpers and use them in Warden so nested
cwd invocations still load root `trails.config.*` and project-local
`.trails/rules*` governance.
