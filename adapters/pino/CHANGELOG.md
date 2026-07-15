# Changelog

## 1.0.0-beta.43

### Minor Changes

- [`50e2779`](https://github.com/outfitter-dev/trails/commit/50e27796d074851bccd57d7df009db749757b457): Extract the real `@ontrails/logtape` and `@ontrails/pino` adapters from the
  temporary observability subpaths. The new packages own their namesake foreign
  dependencies and preserve Trails record metadata, levels, redaction boundaries,
  and lifecycle behavior; the old subpaths are removed in the pre-v1 hard cut.

  Add governed Regrade transitions for both exact import replacements and expose
  the observability adapter target through the shared adapter readiness check.

All notable changes to this package are documented through the Trails release process.
