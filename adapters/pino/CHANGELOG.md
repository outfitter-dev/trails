# Changelog

## 0.2.0

### Patch Changes

- [`664e8bb`](https://github.com/outfitter-dev/trails/commit/664e8bb049e61f1d47cec1dd246606707af5d1a8): Point public installation examples at exact approved 0.2.0 versions and distinguish the prepared source release from pending npm publication.
- [`b3ddf91`](https://github.com/outfitter-dev/trails/commit/b3ddf918ada8211f44983512e2bbdfbc5b66d722): Prepare the first normal Trails release at `0.2.0` on `latest`, replacing the unpublished 1.0.0 source release. The target advances the original `0.1.0` source minor, which was never published under the current package names. Public packages remain in lockstep. Update consumer installation guidance and provide a temporary manifest bridge for old 1.0 beta sources. Published beta versions remain unchanged; minor 0.x releases may carry documented breaking changes.

  The `1.0.0` section retained below records an unpublished preparation, not an npm release. Its accumulated changes are included in `0.2.0`; the section remains as source history alongside the published beta entries.

## 1.0.0

### Minor Changes

- [`50e2779`](https://github.com/outfitter-dev/trails/commit/50e27796d074851bccd57d7df009db749757b457): Extract the real `@ontrails/logtape` and `@ontrails/pino` adapters from the
  temporary observability subpaths. The new packages own their namesake foreign
  dependencies and preserve Trails record metadata, levels, redaction boundaries,
  and lifecycle behavior; the old subpaths are removed in the pre-v1 hard cut.

  Add governed Regrade transitions for both exact import replacements and expose
  the observability adapter target through the shared adapter readiness check.

### Patch Changes

- [`47297d9`](https://github.com/outfitter-dev/trails/commit/47297d98230a4adb25b99b3c8a71217113379398): Treat both `null` and `undefined` Pino flush callback results as success, and verify asynchronous buffered destinations finish writing before the sink resolves.
- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.

## 1.0.0-beta.50

## 1.0.0-beta.49

## 1.0.0-beta.48

## 1.0.0-beta.47

## 1.0.0-beta.46

## 1.0.0-beta.45

## 1.0.0-beta.44

### Patch Changes

- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.

## 1.0.0-beta.43

### Minor Changes

- [`50e2779`](https://github.com/outfitter-dev/trails/commit/50e27796d074851bccd57d7df009db749757b457): Extract the real `@ontrails/logtape` and `@ontrails/pino` adapters from the
  temporary observability subpaths. The new packages own their namesake foreign
  dependencies and preserve Trails record metadata, levels, redaction boundaries,
  and lifecycle behavior; the old subpaths are removed in the pre-v1 hard cut.

  Add governed Regrade transitions for both exact import replacements and expose
  the observability adapter target through the shared adapter readiness check.

All notable changes to this package are documented through the Trails release process.
