# @ontrails/adapter-kit

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
