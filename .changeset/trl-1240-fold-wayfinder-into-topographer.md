---
"@ontrails/topographer": minor
"@ontrails/regrade": patch
"@ontrails/trails": patch
"@ontrails/warden": patch
"@ontrails/source": patch
---

Fold the Wayfinder graph-read catalog into `@ontrails/topographer`. Wayfind
remains the product, trail-id, CLI, and MCP brand, but there is no longer an
`@ontrails/wayfinder` package to install or import. Programmatic consumers
should move imports such as `wayfinderTopo`, `wayfindOverviewTrail`,
`loadWayfinderArtifacts`, and the Wayfinder filter/provenance types to
`@ontrails/topographer`.

Expose that package move as a governed Regrade transition so exact
`@ontrails/wayfinder` imports can move safely while product vocabulary and near
routes remain unchanged for review. Regrade routes package manifests through
structured review instead of rewriting dependency keys as plain text.

The Trails operator now reads all `wayfind.*` query trails and artifact helpers
from `@ontrails/topographer` while preserving the existing CLI/MCP schemas,
route IDs, output shapes, and internal trail visibility.
