---
"@ontrails/adapter-kit": patch
"@ontrails/warden": patch
"@ontrails/trails": patch
---

Fresh derivations now collect app-module overlays through the shared channel compile uses. `@ontrails/adapter-kit` exports `resolveTrailsOverlays()`, the one reader of an app module's `trailsOverlays` export; the compile-path fresh app lease and Warden's fresh topo loading both go through it, making per-namespace drift asymmetry structurally impossible. Warden drift checks (`checkDrift` now accepts derive options carrying overlays) and the topo-aware rule context graph derive with the same overlays the committed lock embeds, so rules like `surface-overlay-coherence` fire on standard runs. Stale drift results name the drifted overlay namespaces (`DriftResult.driftedOverlayNamespaces`) and point at `trails compile` as the remediation.
