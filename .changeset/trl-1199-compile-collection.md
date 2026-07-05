---
'@ontrails/trails': minor
---

`trails compile` and `trails validate` now collect adapter overlay overlays from the app module's `trailsOverlays` export and embed the validated facts as `overlays.<namespace>` in `trails.lock`, threading the registrations through every derivation site so compiled and freshly derived graphs stay hash-identical.
