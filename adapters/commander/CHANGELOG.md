# @ontrails/commander

## 1.0.0-beta.34

## 1.0.0-beta.33

### Patch Changes

- [`945cb4b`](https://github.com/outfitter-dev/trails/commit/945cb4b0bef40ddb098c2a3816f9adad6f135410): Honor explicit structured input values over CLI flag defaults when commands merge
  `--input-json` or `--input` payloads.

  Commander now forwards user-supplied flag metadata so explicit flag values that
  match a default still keep normal CLI precedence over structured input.

## 1.0.0-beta.32

### Patch Changes

- Updated dependencies [3e5c0fc]
- Updated dependencies [f3c4fef]
- Updated dependencies [cb0a9d8]
- Updated dependencies [21c6dda]
- Updated dependencies [860ef32]
- Updated dependencies [fe72b84]
  - @ontrails/core@1.0.0-beta.32
  - @ontrails/cli@1.0.0-beta.32

## 1.0.0-beta.31

### Patch Changes

- Updated dependencies [4cd5d4e]
- Updated dependencies [38907cc]
  - @ontrails/core@1.0.0-beta.31
  - @ontrails/cli@1.0.0-beta.31

## 1.0.0-beta.30

### Patch Changes

- @ontrails/cli@1.0.0-beta.30
- @ontrails/core@1.0.0-beta.30

## 1.0.0-beta.29

### Patch Changes

- @ontrails/cli@1.0.0-beta.29
- @ontrails/core@1.0.0-beta.29

## 1.0.0-beta.28

### Patch Changes

- @ontrails/cli@1.0.0-beta.28
- @ontrails/core@1.0.0-beta.28

## 1.0.0-beta.27

### Patch Changes

- @ontrails/cli@1.0.0-beta.27
- @ontrails/core@1.0.0-beta.27

## 1.0.0-beta.26

### Patch Changes

- Updated dependencies [1307568]
- Updated dependencies [371d19e]
  - @ontrails/core@1.0.0-beta.26
  - @ontrails/cli@1.0.0-beta.26

## 1.0.0-beta.25

### Patch Changes

- 60caabf: Render operator-actionable detail lines after CLI execution errors: validation failures list their topo issues (message plus trail id) and permission failures name the required permit scopes with a copyable `--permit` form. Non-internal Trails error context only, passed through the shared redactor; internal errors keep the redacted generic message.
- dbf4ff4: Emit structured CLI error envelopes for JSON/JSONL command failures and map compile-time Trails DB lock contention to a retryable timeout instead of a generic internal error.
- f1e6efa: Prevent executable parent command defaults from leaking into nested child commands.
- a8e4dc3: Clean up the Wayfinder navigation grammar before RC, including explicit pattern/query/file selectors, target-bound dependency and impact flags, drift-first provenance fields, stricter fires declaration diagnostics, and updated operator dogfood coverage.
- 1d3ae74: Materialize resolved CLI command aliases through the Commander surface while
  preserving the same trail contract and execution path.
- Updated dependencies [c36aca9]
- Updated dependencies [3befcf1]
- Updated dependencies [f1e6efa]
- Updated dependencies [a4f9cf6]
- Updated dependencies [9bcf34e]
- Updated dependencies [f7d97fc]
  - @ontrails/core@1.0.0-beta.25
  - @ontrails/cli@1.0.0-beta.25

## 1.0.0-beta.24

### Patch Changes

- @ontrails/cli@1.0.0-beta.24
- @ontrails/core@1.0.0-beta.24

## 1.0.0-beta.23

### Patch Changes

- @ontrails/cli@1.0.0-beta.23
- @ontrails/core@1.0.0-beta.23

## 1.0.0-beta.22

### Patch Changes

- @ontrails/cli@1.0.0-beta.22
- @ontrails/core@1.0.0-beta.22

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [99523f2]
  - @ontrails/core@1.0.0-beta.21
  - @ontrails/cli@1.0.0-beta.21

## 1.0.0-beta.20

### Patch Changes

- Updated dependencies [851a2a3]
  - @ontrails/core@1.0.0-beta.20
  - @ontrails/cli@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

- e41c382: Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- ed5926b: Add missing TSDoc for public adapter and sink boundary types.
- 1eb5bdc: Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.
- Updated dependencies [e41c382]
- Updated dependencies [a2f1825]
- Updated dependencies [a2f1825]
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
- Updated dependencies [92e709b]
- Updated dependencies [d76be13]
- Updated dependencies [84f56a5]
- Updated dependencies [431b04c]
- Updated dependencies [5d88104]
- Updated dependencies [f04a9ef]
  - @ontrails/core@1.0.0-beta.19
  - @ontrails/cli@1.0.0-beta.19

## 1.0.0-beta.18

### Patch Changes

- @ontrails/cli@1.0.0-beta.18
- @ontrails/core@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- 61497c5: Add v1-minimum public API examples for shipped surface entrypoints.
- Updated dependencies [3dc8254]
- Updated dependencies [61497c5]
  - @ontrails/core@1.0.0-beta.17
  - @ontrails/cli@1.0.0-beta.17

## 1.0.0-beta.16

### Minor Changes

- e991a5b: Add generic enum value aliases for CLI flags and migrate Warden command aliases onto the shared alias model.
- 25f3c5c: Add the dedicated `@ontrails/commander` adapter package and move the Commander runtime out of the `@ontrails/cli/commander` subpath. Extend the repo-local package-source guardrails to cover adapter package source as the Commander runtime moves under `adapters/`.

### Patch Changes

- 20d7a5c: Enforce the shared safe error projection policy for public error bodies, diagnostics, serialized payloads, and CLI stderr.
- df9a7d0: Add project-aware public export-map governance for @ontrails workspace docs,
  imports, root barrels, and bin-only package surfaces.
- Updated dependencies [73622ae]
- Updated dependencies [e991a5b]
- Updated dependencies [25f3c5c]
- Updated dependencies [6300f70]
- Updated dependencies [d172013]
- Updated dependencies [c3fc5c3]
- Updated dependencies [20d7a5c]
- Updated dependencies [be5fb46]
- Updated dependencies [e898cc4]
- Updated dependencies [3395234]
- Updated dependencies [bcdc484]
- Updated dependencies [ed171d5]
- Updated dependencies [49c2e7d]
- Updated dependencies [331e3a9]
- Updated dependencies [4399fdb]
- Updated dependencies [4b8d13b]
- Updated dependencies [fbd42fc]
- Updated dependencies [63d1aef]
- Updated dependencies [112b9f2]
- Updated dependencies [893025e]
- Updated dependencies [ed888e2]
- Updated dependencies [2e05e27]
- Updated dependencies [c8caa5e]
- Updated dependencies [f4b90c9]
- Updated dependencies [eec5e9d]
- Updated dependencies [4e75129]
- Updated dependencies [47505fe]
- Updated dependencies [ebd4434]
- Updated dependencies [863d473]
- Updated dependencies [344f2f7]
- Updated dependencies [26f9ffd]
- Updated dependencies [66056ac]
- Updated dependencies [0bad534]
- Updated dependencies [10eae9a]
- Updated dependencies [22c6c06]
  - @ontrails/core@1.0.0-beta.16
  - @ontrails/cli@1.0.0-beta.16

## 1.0.0-beta.15

Initial package placeholder.
