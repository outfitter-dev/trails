---
"@ontrails/config": patch
"@ontrails/trails": patch
"@ontrails/warden": patch
---

Add a shared Trails config file loader that treats `trails.config.ts` as the natural primary while supporting JSON, JSONC, YAML, and TOML peer formats. Release and Warden config loading now consume the same loader and local overrides can be authored as data files.
