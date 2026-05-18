# @ontrails/logtape

## 1.0.0-beta.18

### Patch Changes

- Updated dependencies [bf44972]
- Updated dependencies [e0ae995]
  - @ontrails/observe@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- @ontrails/observe@1.0.0-beta.17

## 1.0.0-beta.16

### Major Changes

- 68f70fb: Retarget the LogTape adapter to `@ontrails/observe` log sink types and use `createLogtapeSink` as the canonical factory name.
  Refresh the LogTape forwarding migration note for consumers moving off the retired logging package.

### Patch Changes

- 6300f70: Refresh source comments and test labels for retired connector terminology as adapter guardrails become strict.
- a8997ed: Add migration guidance for the retired `@ontrails/logging` package and align observability README examples around `@ontrails/observe`, `@ontrails/tracing`, and `@ontrails/logtape`.
- d40430d: Remove the retired `@ontrails/logging` workspace from the prerelease package set. Use `@ontrails/observe` for log and trace sink contracts and `@ontrails/logtape` for LogTape forwarding.
- Updated dependencies [6300f70]
- Updated dependencies [e898cc4]
- Updated dependencies [a8997ed]
- Updated dependencies [fe03945]
- Updated dependencies [d40430d]
- Updated dependencies [49c2e7d]
- Updated dependencies [9cdb0f2]
- Updated dependencies [22c6c06]
  - @ontrails/observe@1.0.0-beta.16

## 1.0.0-beta.15

### Patch Changes

- @ontrails/observe@1.0.0-beta.15
