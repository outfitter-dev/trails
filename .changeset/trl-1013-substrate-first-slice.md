---
"@ontrails/config": patch
"@ontrails/core": patch
"@ontrails/trails": patch
"@ontrails/warden": patch
---

Centralize Trails config module path conventions, move local config overrides to root `trails.config.local.*`, scaffold the matching gitignore entries, and load project-local Warden rules from `.trails/rules.ts` or `.trails/rules/`.
