# @ontrails/wayfinder

Agent-shaped wayfinding helpers and trails over `@ontrails/topographer` artifacts.

`@ontrails/wayfinder` is the public package home for trails that let agents query a Trails app's resolved topo — overviews, searches, trail details, examples — without re-deriving the graph from `grep` plus file reads.

**Status: substrate only.** No query trails ship yet.

The package currently exports the cold artifact loader and fact provenance helpers that v0 graph-read trails will share. Those helpers read existing Topographer artifacts (`topo.lock`, `trails.lock`, and materialized current `trails.db` topo-store records) without starting apps, booting resources, reaching the network, or mutating local state.

When the query catalog lands, trails such as `wayfind.overview`, `wayfind.search`, `wayfind.contract`, `wayfind.nearby`, `wayfind.impact`, and `wayfind.examples` will be exported from here.
