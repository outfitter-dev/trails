# @ontrails/observe

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

- Updated dependencies [851a2a3]
  - @ontrails/core@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

- 1eb5bdc: Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.
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

- bf44972: Document Pino sink usage and publish-readiness checks.
- e0ae995: Document the v1 `@ontrails/tracing/otel` OpenTelemetry adapter boundary, including callback export, stable `trails.*` attributes, flush behavior, and the absence of a standalone `@ontrails/otel` package.
  - @ontrails/core@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- Updated dependencies [3dc8254]
  - @ontrails/core@1.0.0-beta.17

## 1.0.0-beta.16

### Minor Changes

- d40430d: Remove the retired `@ontrails/logging` workspace from the prerelease package set. Use `@ontrails/observe` for log and trace sink contracts and `@ontrails/logtape` for LogTape forwarding.
- 9cdb0f2: Add `renderTraceTree(records: readonly TraceRecord[]): string` — a pure post-execution renderer that builds a readable execution tree from `TraceRecord` entries. Renders root spans with `●`, children with `├──`/`└──`, status glyphs (`✓`/`✗`/`⊘`), durations, and parallel-branch detection (overlapping siblings render as a bracketed group with wall-vs-total summary). Tolerates forward-compatible record shapes (signal/activation kinds, `attrs.layer` from upcoming layer composition) without crashing — unknown kinds fall through to a generic span renderer. No live streaming; the tree is drawn once after the trail completes.
- 22c6c06: Accept ADR-0041 Unified Observability and ship the first activation and
  observability primitives it depends on: activation trace records, topo-level
  observe configuration, webhook activation materialization, signal/webhook
  warden coaching, the `@ontrails/observe` package, sink composition, and
  zero-dependency observe sinks.

### Patch Changes

- 6300f70: Refresh source comments and test labels for retired connector terminology as adapter guardrails become strict.
- e898cc4: Add repo-level Knip dead-code detection and remove stale internal exports and unused package dependencies surfaced by the new check.
- a8997ed: Add migration guidance for the retired `@ontrails/logging` package and align observability README examples around `@ontrails/observe`, `@ontrails/tracing`, and `@ontrails/logtape`.
- fe03945: Document the v1 observability package boundary: `@ontrails/observe` is the production sink contract package, while `@ontrails/tracing` remains the compatibility and developer-state package with the supported `@ontrails/tracing/otel` adapter subpath.
- 49c2e7d: Refresh published package README taxonomy to use adapter language instead of retired connector vocabulary.
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
