# @ontrails/hono

## 1.0.0-beta.23

### Patch Changes

- Updated dependencies [9c5ecdc]
  - @ontrails/http@1.0.0-beta.23
  - @ontrails/core@1.0.0-beta.23

## 1.0.0-beta.22

### Patch Changes

- @ontrails/core@1.0.0-beta.22
- @ontrails/http@1.0.0-beta.22

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [99523f2]
  - @ontrails/core@1.0.0-beta.21
  - @ontrails/http@1.0.0-beta.21

## 1.0.0-beta.20

### Patch Changes

- Updated dependencies [851a2a3]
  - @ontrails/core@1.0.0-beta.20
  - @ontrails/http@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

- e41c382: Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- ed5926b: Add missing TSDoc for public adapter and sink boundary types.
- 8105f53: Declare the Hono package as an extracted HTTP adapter and dogfood the shared
  adapter authoring check path against its owner conformance test.
- Updated dependencies [e41c382]
- Updated dependencies [1eb5bdc]
- Updated dependencies [f8d80b9]
- Updated dependencies [94a8380]
- Updated dependencies [94a8380]
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
- Updated dependencies [fc00aeb]
- Updated dependencies [ab1c77c]
- Updated dependencies [8ca5b85]
  - @ontrails/core@1.0.0-beta.19
  - @ontrails/http@1.0.0-beta.19

## 1.0.0-beta.18

### Patch Changes

- bc2d327: Close HTTP package documentation around the shared `@ontrails/http/fetch` kernel, Bun-native `@ontrails/http/bun` subpath, and Hono adapter boundary before versioning.
- 20cb72c: Refactor Hono route handling to delegate Web request parsing, response
  projection, diagnostics, permits, and webhook handling through
  `@ontrails/http/fetch`.
- Updated dependencies [c0b2948]
- Updated dependencies [fc3219c]
- Updated dependencies [bc2d327]
  - @ontrails/http@1.0.0-beta.18
  - @ontrails/core@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- 61497c5: Add v1-minimum public API examples for shipped surface entrypoints.
- Updated dependencies [3dc8254]
- Updated dependencies [61497c5]
  - @ontrails/core@1.0.0-beta.17
  - @ontrails/http@1.0.0-beta.17

## 1.0.0-beta.16

### Patch Changes

- f5c6777: Move adapter package workspaces from `connectors/*` to `adapters/*` as part of
  the package-boundary taxonomy cutover. Package names and public APIs are
  unchanged.
- 6300f70: Refresh source comments and test labels for retired connector terminology as adapter guardrails become strict.
- 20d7a5c: Enforce the shared safe error projection policy for public error bodies, diagnostics, serialized payloads, and CLI stderr.
- 95bf132: Wire HTTP permit resolution through the Hono adapter, including request headers for Bearer Authorization handling.
- 729f957: Harden the Hono surface by capping JSON request bodies at 1 MiB by default and
  redacting generic internal errors while preserving server-side diagnostics.
- 49c2e7d: Refresh published package README taxonomy to use adapter language instead of retired connector vocabulary.
- df9a7d0: Add project-aware public export-map governance for @ontrails workspace docs,
  imports, root barrels, and bin-only package surfaces.
- Updated dependencies [73622ae]
- Updated dependencies [6300f70]
- Updated dependencies [d172013]
- Updated dependencies [c3fc5c3]
- Updated dependencies [20d7a5c]
- Updated dependencies [be5fb46]
- Updated dependencies [95bf132]
- Updated dependencies [e898cc4]
- Updated dependencies [2bf239e]
- Updated dependencies [3395234]
- Updated dependencies [bcdc484]
- Updated dependencies [49c2e7d]
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
- Updated dependencies [df9a7d0]
  - @ontrails/core@1.0.0-beta.16
  - @ontrails/http@1.0.0-beta.16

## 1.0.0-beta.15

### Patch Changes

- Updated dependencies [4ad6b25]
  - @ontrails/core@1.0.0-beta.15
  - @ontrails/http@1.0.0-beta.15
