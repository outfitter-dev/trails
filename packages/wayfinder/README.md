# @ontrails/wayfinder

Agent-shaped wayfinding trails over `@ontrails/topographer` artifacts.

`@ontrails/wayfinder` is the public package home for trails that let agents
query a Trails app's resolved topo — overviews, searches, trail details,
examples — without re-deriving the graph from `grep` plus file reads.

**Status: shell only.** No trails ship yet. The v0 catalog and design are
captured in the wayfinding draft ADR:

- [`docs/adr/drafts/20260503-wayfinding.md`](../../docs/adr/drafts/20260503-wayfinding.md)

This package currently exists to reserve the `@ontrails/wayfinder` namespace
and give the v0 implementation a clean home. When wayfinding lands as an
accepted ADR, trails such as `wayfind.overview`, `wayfind.search`,
`wayfind.trail`, and `wayfind.examples` will be exported from here.
