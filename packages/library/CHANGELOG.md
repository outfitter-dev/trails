# @ontrails/library

## 1.0.0-beta.45

### Patch Changes

- [`f9533a4`](https://github.com/outfitter-dev/trails/commit/f9533a4ef7392201c71d7f751361b4f7177eeacb): Keep public error projection shared and redacted while using transport-neutral CLI vocabulary and preserving safe topo diagnostics in structured output.

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

### Patch Changes

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

## 1.0.0-beta.39

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

- 8097663: Project typed layer inputs through the library surface and generated packages. The runtime now validates the combined public input, routes layer-owned fields into per-layer input slots, and generated packages share one held client across root and result subpaths while avoiding Bun-only ambient type assumptions in their emitted tsconfig.
- d4c8600: Make the library surface package publishable so generated Trails libraries can depend on the shared runtime-backed surface outside the monorepo.
- Updated dependencies [c36aca9]
- Updated dependencies [3befcf1]
- Updated dependencies [a4f9cf6]
- Updated dependencies [9bcf34e]
  - @ontrails/core@1.0.0-beta.25

## 1.0.0-beta.24

Initial prerelease changelog for the library surface package.
