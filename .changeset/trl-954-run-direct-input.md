---
'@ontrails/trails': patch
---

Restore caller-facing direct input for `trails run` so positional JSON,
`--input-json`, and `--input` payloads map to the target trail input unless
callers explicitly use the `input` wrapper for control-field collisions.
