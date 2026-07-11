---
"@ontrails/topography": minor
---

**BREAKING:** Rename surface-map exposure fields from `trailheads` to `surfaces`.

`SurfaceMapEntry.trailheads` is now `SurfaceMapEntry.surfaces`, persisted surface-map JSON now writes `surfaces`, and diff details now report `Surface "<name>" added/removed`.

See `docs/migration/trailhead-to-surface.md` for the full migration map.
