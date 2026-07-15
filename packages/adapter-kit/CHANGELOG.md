# @ontrails/adapter-kit

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

### Patch Changes

- [`4def007`](https://github.com/outfitter-dev/trails/commit/4def007a53c42881fba1d958a67f0c05f417e811): Move adapter source export scanning into adapter-kit and have `create.adapter`
  consume the shared helper.
- [`78575d5`](https://github.com/outfitter-dev/trails/commit/78575d5193242053b4dc1f4fa6150b94bacaff44): Discover owner-package subpath adapter subjects in shared adapter checks and
  enable `trails create adapter --placement subpath` to generate immediately
  checkable owner subpaths.
- [`9bf592d`](https://github.com/outfitter-dev/trails/commit/9bf592ddba46aa12e3f4e6ffc0f772f7a41ed3df): Declare verified first-party adapter metadata for Drizzle, HTTP/Bun, and Store/Jsonfile so shared adapter checks can dogfood real owner targets.

## 1.0.0-beta.39

### Minor Changes

- [`cc169e2`](https://github.com/outfitter-dev/trails/commit/cc169e2a9b580036b0c6e4ce77d396db6a34f830): Add the `Overlay` contract (namespace + elevated zod fact schema + deterministic derive function) so adapters can contribute namespaced fact overlays to `trails.lock` without any edits to the lock schema or graph type, plus an `isOverlay` guard for compile-side collection.

### Patch Changes

- [`bafde1f`](https://github.com/outfitter-dev/trails/commit/bafde1fc8172abb8d8617f69a3c7a70667626d10): Fresh derivations now collect app-module overlays through the shared channel compile uses. `@ontrails/adapter-kit` exports `resolveTrailsOverlays()`, the one reader of an app module's `trailsOverlays` export; the compile-path fresh app lease and Warden's fresh topo loading both go through it, making per-namespace drift asymmetry structurally impossible. Warden drift checks (`checkDrift` now accepts derive options carrying overlays) and the topo-aware rule context graph derive with the same overlays the committed lock embeds, so rules like `surface-overlay-coherence` fire on standard runs. Stale drift results name the drifted overlay namespaces (`DriftResult.driftedOverlayNamespaces`) and point at `trails compile` as the remediation.
- [`820b4ad`](https://github.com/outfitter-dev/trails/commit/820b4ad9c40ea383b3c489a05fe7e4b2328e324f): Add `surfaceOverlay` — the shared surface-naming schema (scalar binding = synonym, list binding = grouped entry, singleton list stays a group) with app-authored/adapter-derived overlay provenance enforced at collection and consumption, and the `surface-overlay-coherence` Warden rule. MCP tool-name derivation moves to `@ontrails/core` (`deriveMcpToolName`) so the surface and governance read one projection; `@ontrails/mcp`'s `deriveToolName` now delegates to it. The coherence rule activates on standard warden runs once fresh derivations collect app-module overlays through the shared compile channel (TRL-1209, next in this stack).

## 1.0.0-beta.38

## 1.0.0-beta.37

## 1.0.0-beta.36

## 1.0.0-beta.35

## 1.0.0-beta.34

## 1.0.0-beta.33

## 1.0.0-beta.32

### Patch Changes

- 3e5c0fc: Export shared diagnostic base types from core and align governance diagnostic
  severity vocabulary across adapter checks, permits, and Warden.
- f3c4fef: Export a shared `escapeRegExp` helper from core and migrate first-party callers off local copies.
- cb0a9d8: Export shared workspace package discovery helpers from core and migrate first-party discovery callers.
- Updated dependencies [3e5c0fc]
- Updated dependencies [f3c4fef]
- Updated dependencies [cb0a9d8]
- Updated dependencies [21c6dda]
- Updated dependencies [fe72b84]
  - @ontrails/core@1.0.0-beta.32

## 1.0.0-beta.31

## 1.0.0-beta.30

## 1.0.0-beta.29

## 1.0.0-beta.28

## 1.0.0-beta.27

## 1.0.0-beta.26

## 1.0.0-beta.25

## 1.0.0-beta.24

## 1.0.0-beta.23

## 1.0.0-beta.22

## 1.0.0-beta.21

### Patch Changes

- 3caa263: Add adapter fact projections to the shared adapter readiness report so downstream tooling can distinguish available targets, configured adapter packages, and conformance-backed usage evidence.

## 1.0.0-beta.20

### Patch Changes

- eee1307: Serialize resolved surface facet metadata in TopoGraph artifacts and expose adapter type evidence for downstream projection checks.

## 1.0.0-beta.19

### Patch Changes

- bb81ffe: Resolve declared adapter owner imports through wildcard package export keys
  before reporting missing owner subpath exports.
- fc00aeb: Add adapter target conformance metadata and scaffold extracted HTTP adapters through `trails create adapter`.
- 4f43874: Add the shared adapter readiness check engine for authoring and review workflows.
- 678cb1c: Expose the shared adapter readiness engine through Warden's opt-in
  `--adapter-check` diagnostics and the local `trails adapter check` authoring
  workflow.
