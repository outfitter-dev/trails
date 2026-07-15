# Changelog

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
