---
'@ontrails/core': patch
'@ontrails/mcp': patch
'@ontrails/topography': patch
'@ontrails/warden': patch
'@ontrails/trails': patch
---

Wave-2 MCP cutover to the app-authored `surfaces` overlay. The overlay's `mcp` bindings are now the authored, lockable default for the MCP surface: a list binding derives one grouped trailhead tool (member selection in `{ trail, input }`, member identity preserved in `{ trail, output }`, deterministic derived description), and a scalar binding derives an additional tool synonym whose MCP-safe name is published verbatim and must expand to exactly one trail. `deriveMcpTools`/`createServer` accept the new `overlays` option; `@ontrails/core` gains `expandMcpSurfaceBindings` and `deriveMcpTrailheadDescription`.

The call-site `CreateServerOptions.trailheads` map survives as permanent override-in-context design, not a compatibility bridge: when both channels are present, the call-site map wins at runtime. Warden's new `trailhead-override-divergence` rule (warn) names both sides when a call-site map's binding names or member selectors diverge from the authored overlay default.

Topographer now derives `graph.trailheads` from the overlay's `mcp` list bindings in both `deriveTopoGraph` and the store-side graph build, so trailhead facts flow from compiled locks into Wayfinder reads for the first time. The never-wired `DeriveTopoGraphOptions.trailheads` option and the `TopoGraphTrailheadDeclaration`/`TopoGraphTrailheadTrailSelector` types are removed — a beta-window hard cutover of an option no caller could reach; author the equivalent `mcp` list binding in `surfaceOverlay({ mcp })` instead.
