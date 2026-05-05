---
"@ontrails/core": minor
---

**BREAKING:** Complete the `trailhead` to `surface` public API cutover in core.

- `TraceRecord.trailhead` is now `TraceRecord.surface`.
- `SURFACE_KEY` now uses the `__trails_surface` extension key value, and the deprecated `TRAILHEAD_KEY` alias is removed.
- Deprecated `transport*` surface-error aliases are removed; import the existing `surface*` names instead.
- `isVisibleToTrailheads` is renamed to `isVisibleToSurfaces`.

See `docs/migration/trailhead-to-surface.md` for the full migration map.
