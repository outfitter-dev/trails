# @ontrails/source

## 1.0.0-beta.44

### Patch Changes

- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.

## 1.0.0-beta.43

### Minor Changes

- [`88a6a62`](https://github.com/outfitter-dev/trails/commit/88a6a62a9e9e230ca6d368fa78dc3ece6c816204): Complete the v1 classification-first cutover from projection/project vocabulary
  to derive/derived for contract-owned fact production and render/rendered for
  surface presentation. Public type, helper, rule, relation, and report names move
  without compatibility aliases; ordinary repository/project nouns remain
  explicit preserves or structured review inventory.

## 1.0.0-beta.42

## 1.0.0-beta.41

## 1.0.0-beta.40

### Minor Changes

- [`35cbe28`](https://github.com/outfitter-dev/trails/commit/35cbe289db46539b3689dbf6cf8ab0e5d9a1b09c): Found `@ontrails/source` as the shared source-code AST kernel for parsing,
  walking, locations, edits, literals, and generic Trails syntax recognition.
  Warden, Regrade, Wayfinder, and the Trails operator now import those shared
  mechanics from `@ontrails/source`; the legacy Warden AST route is removed by the
  stacked hard cutover.

### Patch Changes

- [`3531b58`](https://github.com/outfitter-dev/trails/commit/3531b58ba5320753d6d2594257ef71bc950d28a1): Add the advisory captured-kernel Warden rule for ownership review when a public
  subpath re-exports package internals and multiple production workspaces consume
  that subpath, including import-then-export barrels that preserve the internal
  binding through a local alias or default export.

  Expose typed import-kind inspection from `@ontrails/source` so project rules
  can keep erased type bindings separate from runtime exports.

- [`10f2492`](https://github.com/outfitter-dev/trails/commit/10f24928d3bc9d995abf7aa261ecf515c295855d): Own the `wayfind.outline` implementation in the Trails operator app while preserving the existing `trails wayfind file <file> --outline` CLI and MCP composition behavior, and document `@ontrails/source` as the operator's live-source analysis kernel.
- [`35e5fed`](https://github.com/outfitter-dev/trails/commit/35e5fedd228e498783f479f0dd502e2f3ec772b8): Fold the Wayfinder graph-read catalog into `@ontrails/topography`. Wayfind
  remains the product, trail-id, CLI, and MCP brand, but there is no longer an
  `@ontrails/wayfinder` package to install or import. Programmatic consumers
  should move imports such as `wayfinderTopo`, `wayfindOverviewTrail`,
  `loadWayfinderArtifacts`, and the Wayfinder filter/provenance types to
  `@ontrails/topography`.

  Expose that package move as a governed Regrade transition so exact
  `@ontrails/wayfinder` imports can move safely while product vocabulary and near
  routes remain unchanged for review. Regrade routes package manifests through
  structured review instead of rewriting dependency keys as plain text.

  The Trails operator now reads all `wayfind.*` query trails and artifact helpers
  from `@ontrails/topography` while preserving the existing CLI/MCP schemas,
  route IDs, output shapes, and internal trail visibility.

- [`3a65ae3`](https://github.com/outfitter-dev/trails/commit/3a65ae363e05b7589f4a9876da4346886353b48c): Rename the durable graph substrate package from `@ontrails/topographer` to
  `@ontrails/topography` after folding Wayfind graph queries into that owner.

  Update imports to `@ontrails/topography` or
  `@ontrails/topography/backend-support`. The pre-1.0 cutover does not ship a
  compatibility package. TopoGraph, lock, topo-store, semantic diff, and Wayfind
  APIs keep their existing contracts, and the `trails wayfind` CLI and MCP names
  remain unchanged.

  The governed package-route transition moves legacy `@ontrails/wayfinder`
  imports directly to `@ontrails/topography`; it does not emit the retired
  intermediate `@ontrails/topographer` route.
