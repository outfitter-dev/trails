---
"@ontrails/tracing": minor
---

**BREAKING:** Complete the tracing wire-format cutover from `trailhead` to `surface`.

- OTel attributes now use `trails.surface` instead of `trails.trailhead`.
- The SQLite dev-store schema now writes the `surface` column instead of `trailhead`.
- `tracing.query` records now expose `surface` instead of `trailhead`.
- The legacy `.trails/dev/tracing.db` migration bridge has been removed; reset local dev stores before upgrading.

See `docs/migration/trailhead-to-surface.md` for the full migration map.
