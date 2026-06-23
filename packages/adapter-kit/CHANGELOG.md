# @ontrails/adapter-kit

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
