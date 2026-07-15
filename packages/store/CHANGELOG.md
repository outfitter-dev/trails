# @ontrails/store

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

- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.
- [`6712075`](https://github.com/outfitter-dev/trails/commit/67120754df3f614c7f4dd98be1fa0ba9d69b7765): Complete the v1 hard cutover from the `contour` domain-object declaration
  vocabulary to `entity` across contracts, topo facts, store helpers, Warden,
  Wayfinder, operator surfaces, examples, and generated locks. Existing
  applications must rename contour APIs, run `trails dev reset --yes` to discard
  pre-cutover local Topographer snapshots, and then recompile committed
  `trails.lock` artifacts before upgrading. Those derived snapshots are
  intentionally not read through a compatibility layer.
  The entity-shaped wire contract advances `TopoGraph` and split lock manifests
  from schema version 3 to 4; old split artifacts fail with regeneration guidance,
  while the canonical root `trails.lock` remains schema version 5.
  Wayfinder reports those stale rows as topo-store drift while keeping current
  committed lock facts available for inspection.

### Patch Changes

- [`9874e0b`](https://github.com/outfitter-dev/trails/commit/9874e0bb034c0f98edeb19833d9d3519c2a07a4c): Add `@ontrails/cloudflare/d1`, an env-bound Cloudflare D1 store resource for `@ontrails/store` definitions. The new subpath exports `cloudflareD1` and `connectD1`, supports the backend-agnostic store accessor contract (`get`, `list`, `upsert`, `remove`), versioned-table optimistic concurrency, fixture/mock seeding, store-derived write signals, Miniflare-backed conformance tests, and Worker env-bridge integration.

  `@ontrails/core` and `@ontrails/store` no longer require the Bun global for signal fire ids or late-bound store signal tokens, so store definitions and store-derived signal emission work inside Worker modules. `@ontrails/warden` now treats `cloudflareD1` as a required Cloudflare public export with `@example` coverage.

- [`9bf592d`](https://github.com/outfitter-dev/trails/commit/9bf592ddba46aa12e3f4e6ffc0f772f7a41ed3df): Declare verified first-party adapter metadata for Drizzle, HTTP/Bun, and Store/Jsonfile so shared adapter checks can dogfood real owner targets.

## 1.0.0-beta.39

### Patch Changes

- [`f7ec225`](https://github.com/outfitter-dev/trails/commit/f7ec225c01482f8fb55afd174add3d961a63171b): `sync()` gains the factory-contract options `crud()` and `reconcile()` received in TRL-1195: a `permit` option declared on the produced trail, and per-endpoint `contour` options on `SyncEndpoint` so a `crud()` bundle's table contour can be shared instead of colliding as a duplicate registration at `topo()`.
- [`5a38c73`](https://github.com/outfitter-dev/trails/commit/5a38c73092f81612769be4b44944d828c3436e07): Complete the store factory trail contracts (TRL-1195, absorbing TRL-1177 and TRL-1178). `crud()` gains `permit` (applied to every produced trail) and `permits` (per-operation overrides, so destroy trails satisfy permit governance) plus a `contour` option, and the returned tuple now exposes the table contour it registered as a `contour` property. `reconcile()` gains `permit` and accepts a shared `contour` instance, so crud + reconcile on one table register cleanly in a single `topo()` instead of colliding on a duplicate contour name. `TableContour` is exported from `@ontrails/store/trails`. Consuming apps no longer need to post-process factory trails to attach permits or strip contours.

## 1.0.0-beta.38

## 1.0.0-beta.37

## 1.0.0-beta.36

## 1.0.0-beta.35

## 1.0.0-beta.34

## 1.0.0-beta.33

## 1.0.0-beta.32

### Patch Changes

- Updated dependencies [3e5c0fc]
- Updated dependencies [f3c4fef]
- Updated dependencies [cb0a9d8]
- Updated dependencies [21c6dda]
- Updated dependencies [fe72b84]
  - @ontrails/core@1.0.0-beta.32

## 1.0.0-beta.31

### Patch Changes

- Updated dependencies [4cd5d4e]
- Updated dependencies [38907cc]
  - @ontrails/core@1.0.0-beta.31

## 1.0.0-beta.30

### Patch Changes

- @ontrails/core@1.0.0-beta.30

## 1.0.0-beta.29

### Patch Changes

- @ontrails/core@1.0.0-beta.29

## 1.0.0-beta.28

### Patch Changes

- @ontrails/core@1.0.0-beta.28

## 1.0.0-beta.27

### Patch Changes

- @ontrails/core@1.0.0-beta.27

## 1.0.0-beta.26

### Patch Changes

- Updated dependencies [1307568]
- Updated dependencies [371d19e]
  - @ontrails/core@1.0.0-beta.26

## 1.0.0-beta.25

### Patch Changes

- Updated dependencies [c36aca9]
- Updated dependencies [3befcf1]
- Updated dependencies [a4f9cf6]
- Updated dependencies [9bcf34e]
  - @ontrails/core@1.0.0-beta.25

## 1.0.0-beta.24

### Patch Changes

- @ontrails/core@1.0.0-beta.24

## 1.0.0-beta.23

### Patch Changes

- @ontrails/core@1.0.0-beta.23

## 1.0.0-beta.22

### Patch Changes

- @ontrails/core@1.0.0-beta.22

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [99523f2]
  - @ontrails/core@1.0.0-beta.21

## 1.0.0-beta.20

### Patch Changes

- 851a2a3: Derive trail caller and blaze input types from the authored input schema while keeping one public input contract.
- Updated dependencies [851a2a3]
  - @ontrails/core@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

- e41c382: Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- ab1c77c: Advertise first-party adapter target metadata for catalog derivation.
- Updated dependencies [e41c382]
- Updated dependencies [1eb5bdc]
- Updated dependencies [f8d80b9]
- Updated dependencies [846a597]
- Updated dependencies [223aaad]
- Updated dependencies [3125f4d]
- Updated dependencies [2494dc6]
- Updated dependencies [2d53717]
- Updated dependencies [16cb740]
- Updated dependencies [8894ecb]
- Updated dependencies [fdf7ec9]
- Updated dependencies [d76be13]
- Updated dependencies [84f56a5]
- Updated dependencies [431b04c]
- Updated dependencies [5d88104]
- Updated dependencies [f04a9ef]
  - @ontrails/core@1.0.0-beta.19

## 1.0.0-beta.18

### Patch Changes

- @ontrails/core@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- Updated dependencies [3dc8254]
  - @ontrails/core@1.0.0-beta.17

## 1.0.0-beta.16

### Major Changes

- 3395234: Move store adapter-binding helpers to `@ontrails/store/adapter-support` and topographer direct database/admin helpers to `@ontrails/topographer/backend-support`, keeping root exports focused on contract-level APIs.
- 6300f70: BREAKING: rename the shared store backend option type from `StoreConnectorOptions` to `StoreAdapterOptions`.

### Patch Changes

- e898cc4: Add repo-level Knip dead-code detection and remove stale internal exports and unused package dependencies surfaced by the new check.
- 49c2e7d: Refresh published package README taxonomy to use adapter language instead of retired connector vocabulary.
- df9a7d0: Add project-aware public export-map governance for @ontrails workspace docs,
  imports, root barrels, and bin-only package surfaces.
- Updated dependencies [73622ae]
- Updated dependencies [6300f70]
- Updated dependencies [d172013]
- Updated dependencies [c3fc5c3]
- Updated dependencies [20d7a5c]
- Updated dependencies [be5fb46]
- Updated dependencies [e898cc4]
- Updated dependencies [3395234]
- Updated dependencies [bcdc484]
- Updated dependencies [331e3a9]
- Updated dependencies [4399fdb]
- Updated dependencies [4b8d13b]
- Updated dependencies [112b9f2]
- Updated dependencies [893025e]
- Updated dependencies [eec5e9d]
- Updated dependencies [ebd4434]
- Updated dependencies [863d473]
- Updated dependencies [344f2f7]
- Updated dependencies [26f9ffd]
- Updated dependencies [10eae9a]
- Updated dependencies [22c6c06]
  - @ontrails/core@1.0.0-beta.16

## 1.0.0-beta.15

### Patch Changes

- Updated dependencies [4ad6b25]
  - @ontrails/core@1.0.0-beta.15

## 1.0.0-beta.14

### Minor Changes

- 69057e9: Add hierarchical CLI command trees and structured input, enforce established-only topo exports across trailheads, move developer topo and tracker state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.

### Patch Changes

- Updated dependencies [69057e9]
  - @ontrails/core@1.0.0-beta.14
