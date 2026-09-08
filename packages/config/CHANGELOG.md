# @ontrails/config

## 1.0.0

### Major Changes

- [`10eae9a`](https://github.com/outfitter-dev/trails/commit/10eae9a96079dde67227191f670ba7ed1b40fef2): Migrate the Trails workspace to the documented `.trails/` layout: committed `.lock` files at the workspace root, ignored `cache/` for rebuildable derived data, ignored `state/` for mutable runtime state, and `.trails/config.local.{ts,js}` for local overrides. The default SQLite path is now `.trails/state/trails.db`. Workspace bootstrap creates only `cache/` and `state/` — the legacy `dev/` and `generated/` subdirectories are no longer created. Dev reset cleans both the new `.trails/state/` paths and legacy `.trails/trails.db*` and `.trails/dev/tracing.db*` paths for one cycle. Scaffold and workspace gitignores reflect the new layout.

  Workspace bootstrap is now owned by a single canonical source in `@ontrails/core`. The package exposes `ensureTrailsWorkspace()`, `WORKSPACE_GITIGNORE_CONTENT`, and `WORKSPACE_GITIGNORE_LINES`. `@ontrails/config` no longer exports its own `ensureWorkspace` (consumers should import from `@ontrails/core`). `trails create` now writes `.trails/.gitignore` during scaffolding so a fresh-scaffolded project's initial commit includes the workspace gitignore (resolves TRL-703).

### Minor Changes

- [`6944147`](https://github.com/outfitter-dev/trails/commit/694414712949a1107235684a2492ac982ed39a20): Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configResource`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authResource` and `auth.verify` trail for runtime authorization checks
  - **tracing**: Rename tracks to tracing; add `tracingResource` and `tracing.status` trail for structured signal tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for resource and composition updates

- [`69057e9`](https://github.com/outfitter-dev/trails/commit/69057e9348006b2b70c9f6237572a5aa8de3ee1f): Add hierarchical CLI command trees and structured input, enforce established-only topo exports across surfaces, move developer topo and tracing state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.
- [`1679687`](https://github.com/outfitter-dev/trails/commit/1679687219431c38cdc7f46de8de60ccac49fd3c): Add Config-owned static `workspace.apps` identity with bounded, non-executing TypeScript extraction, shared data-format validation, convention-derived app entries, and normalized project paths. Type-only wrappers remain transparent, unrelated deployment expressions stay outside identity proof, duplicate identity keys fail before parser collapse, separator aliases cannot create competing app-root owners, and Source preserves declared submodule boundaries when their checkouts are absent. YAML workspace identity must stay literal, JSON-compatible data: alias references and merge keys inside the workspace subtree now fail closed before identity resolution instead of collapsing silently at parse time, while an anchor definition that nothing references stays inert and cannot alter the resolved identity. Invalid discovery start directories also fail closed: a start path that is missing or is not a directory now raises a typed `ValidationError` naming it instead of silently walking up to an ancestor project's identity.
- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.
- [`fde5516`](https://github.com/outfitter-dev/trails/commit/fde5516ad396faa718936b10ff658b3ade3383b9): Trail-native vocabulary cutover. Breaking API field renames across all packages:

  - Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `resources:`, `metadata:` → `meta:`, `emits:` → `fires:`
  - Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.fire()`, `ctx.signal` (abort) → `ctx.abortSignal`
  - Entry points: `trailhead(app)` → `surface(app)`
  - Package rename: `@ontrails/crumbs` / `@ontrails/tracker` → `@ontrails/tracing`
  - Wrapper types: retired gate/middleware vocabulary in favor of `Layer` and `layers`
  - Package taxonomy: retired connector vocabulary in favor of adapters

- [`082408e`](https://github.com/outfitter-dev/trails/commit/082408e32c16fd737d8899fc8c8a51fa0f61b3d9): Warn when a configured workspace contains a nested `trails.lock` outside `workspace.apps`, and reject a workspace-root aggregate lock without deriving app identity from either artifact.

  Make the Trails operator topo reproducible by keeping its authored examples free of temporary filesystem paths, so its committed app-owned lock validates deterministically.

  Replay known operator current-app examples through the selected Config entry, including the nested project input in the authored `run` example, so custom app layouts do not fall back to `src/app.ts` without rewriting matching fields in domain examples.

  Add `trails config explain` as the operator-owned inspection surface for source-static project and app identity. It reports the Config-authored catalog, selected extent, and selection provenance without loading app modules or reading locks.

  **BREAKING:** Remove the public `@ontrails/config` `configExplain` trail export. Library consumers that inspect resolved deployment provenance must migrate to `deriveConfigProvenance`; operators and agents that inspect Config-authored app identity must migrate to `trails config explain`. The broader config cascade stays deferred.

### Patch Changes

- [`3dc8254`](https://github.com/outfitter-dev/trails/commit/3dc82547f428bcb6adb7eac1201a0c87cf63b8af): Fix README TypeScript snippets so the expanded documentation snippet gate can verify them.
- [`49c2e7d`](https://github.com/outfitter-dev/trails/commit/49c2e7d5c7c063b9aa6abee1d2932bf3003133cc): Refresh published package README taxonomy to use adapter language instead of retired connector vocabulary.
- [`1307568`](https://github.com/outfitter-dev/trails/commit/13075680e1c77c0a3abee36aaecce8cecad2f347): Centralize Trails config module path conventions, move local config overrides to root `trails.config.local.*`, scaffold the matching gitignore entries, and load project-local Warden rules from `.trails/rules.ts` or `.trails/rules/`.
- [`ef09e46`](https://github.com/outfitter-dev/trails/commit/ef09e4673563fc3b763fef3df510b34d67c45fe1): Add shared Trails project-root discovery helpers and use them in Warden so nested
  cwd invocations still load root `trails.config.*` and project-local
  `.trails/rules*` governance.
- [`38cd9d6`](https://github.com/outfitter-dev/trails/commit/38cd9d63ad40ae45986f6bdb01109f383b3a19ab): Add a shared Trails config file loader that treats `trails.config.ts` as the natural primary while supporting JSON, JSONC, YAML, and TOML peer formats. Release and Warden config loading now consume the same loader and local overrides can be authored as data files.
- [`2b819f4`](https://github.com/outfitter-dev/trails/commit/2b819f4f805737439844af29a7c411d4af7c0bba): Rename config check reports to `ConfigReport` and `ConfigFieldReport`, and return field reports from `config.check`.
- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.
- [`1e168b1`](https://github.com/outfitter-dev/trails/commit/1e168b16caa5014f641fea37d028820211fb2ae1): Resolve one shared project context for `trails compile` and `trails validate`.
  Configured workspaces now select apps through `--app` or app-root CWD, compile
  exactly one app lock without root fanout, validate either one app or the complete
  workspace, enforce configured topo-name binding and collection boundaries, and
  return machine-readable selection and completeness provenance. Project-root
  discovery can now be bounded to one working tree so linked and nested checkouts
  do not borrow identity from a parent collection. Without Git metadata the
  boundary walk continues to the outermost workspace declaration, so nested or
  overlapping workspaces fail closed with a typed error naming both roots instead
  of silently selecting the nearest one. Custom `--module` entries stay
  relative to the selected standalone app root, and complete workspace validation
  derives saved binding and freshness evidence once after validating each live app.
- [`99523f2`](https://github.com/outfitter-dev/trails/commit/99523f2a67e92091781165b6c847252b910554e2): Clean up resource context naming in shipped source and examples so resource
  factories consistently use resource vocabulary.

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

## 1.0.0-beta.42

## 1.0.0-beta.41

## 1.0.0-beta.40

### Minor Changes

- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.

## 1.0.0-beta.39

## 1.0.0-beta.38

## 1.0.0-beta.37

## 1.0.0-beta.36

## 1.0.0-beta.35

## 1.0.0-beta.34

## 1.0.0-beta.33

## 1.0.0-beta.32

### Patch Changes

- 2b819f4: Rename config check reports to `ConfigReport` and `ConfigFieldReport`, and return field reports from `config.check`.
- Updated dependencies [3e5c0fc]
- Updated dependencies [f3c4fef]
- Updated dependencies [cb0a9d8]
- Updated dependencies [21c6dda]
- Updated dependencies [fe72b84]
  - @ontrails/core@1.0.0-beta.32

## 1.0.0-beta.31

### Patch Changes

- Updated dependencies [4cd5d4e]
- Updated dependencies [38907cc]
  - @ontrails/core@1.0.0-beta.31

## 1.0.0-beta.30

### Patch Changes

- @ontrails/core@1.0.0-beta.30

## 1.0.0-beta.29

### Patch Changes

- @ontrails/core@1.0.0-beta.29

## 1.0.0-beta.28

### Patch Changes

- @ontrails/core@1.0.0-beta.28

## 1.0.0-beta.27

### Patch Changes

- @ontrails/core@1.0.0-beta.27

## 1.0.0-beta.26

### Patch Changes

- 1307568: Centralize Trails config module path conventions, move local config overrides to root `trails.config.local.*`, scaffold the matching gitignore entries, and load project-local Warden rules from `.trails/rules.ts` or `.trails/rules/`.
- ef09e46: Add shared Trails project-root discovery helpers and use them in Warden so nested
  cwd invocations still load root `trails.config.*` and project-local
  `.trails/rules*` governance.
- 38cd9d6: Add a shared Trails config file loader that treats `trails.config.ts` as the natural primary while supporting JSON, JSONC, YAML, and TOML peer formats. Release and Warden config loading now consume the same loader and local overrides can be authored as data files.
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

- 99523f2: Clean up resource context naming in shipped source and examples so resource
  factories consistently use resource vocabulary.
- Updated dependencies [99523f2]
  - @ontrails/core@1.0.0-beta.21

## 1.0.0-beta.20

### Patch Changes

- Updated dependencies [851a2a3]
  - @ontrails/core@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

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

- @ontrails/core@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- 3dc8254: Fix README TypeScript snippets so the expanded documentation snippet gate can verify them.
- Updated dependencies [3dc8254]
  - @ontrails/core@1.0.0-beta.17

## 1.0.0-beta.16

### Major Changes

- 10eae9a: Migrate the Trails workspace to the documented `.trails/` layout: committed `.lock` files at the workspace root, ignored `cache/` for rebuildable derived data, ignored `state/` for mutable runtime state, and `.trails/config.local.{ts,js}` for local overrides. The default SQLite path is now `.trails/state/trails.db`. Workspace bootstrap creates only `cache/` and `state/` — the legacy `dev/` and `generated/` subdirectories are no longer created. Dev reset cleans both the new `.trails/state/` paths and legacy `.trails/trails.db*` and `.trails/dev/tracing.db*` paths for one cycle. Scaffold and workspace gitignores reflect the new layout.

  Workspace bootstrap is now owned by a single canonical source in `@ontrails/core`. The package exposes `ensureTrailsWorkspace()`, `WORKSPACE_GITIGNORE_CONTENT`, and `WORKSPACE_GITIGNORE_LINES`. `@ontrails/config` no longer exports its own `ensureWorkspace` (consumers should import from `@ontrails/core`). `trails create` now writes `.trails/.gitignore` during scaffolding so a fresh-scaffolded project's initial commit includes the workspace gitignore (resolves TRL-703).

### Patch Changes

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

## 1.0.0-beta.15

### Patch Changes

- Updated dependencies [4ad6b25]
  - @ontrails/core@1.0.0-beta.15

## 1.0.0-beta.14

### Minor Changes

- 69057e9: Add hierarchical CLI command trees and structured input, enforce established-only topo exports across trailheads, move developer topo and tracker state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.

### Patch Changes

- Updated dependencies [69057e9]
  - @ontrails/core@1.0.0-beta.14

## 1.0.0-beta.13

### Minor Changes

- 6944147: Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configProvision`, `configGate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authService` and `auth.verify` trail for runtime authorization checks
  - **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured signal tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for provision and composition updates

- Trail-native vocabulary cutover. Breaking API field renames across all packages:

  - Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `provisions:`, `metadata:` → `meta:`, `emits:` → `signals:`
  - Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.signal()`, `ctx.signal` (abort) → `ctx.abortSignal`
  - Entry points: `blaze(app)` → `trailhead(app)`
  - Package rename: `@ontrails/crumbs` → `@ontrails/tracker`
  - Wrapper types: `Layer` → `Gate`, `layers`/`middleware` → `gates`
  - Transport: `surface` → `trailhead`, `adapter` → `connector`

### Patch Changes

- Updated dependencies [6944147]
- Updated dependencies
  - @ontrails/core@1.0.0-beta.13

## 1.0.0-beta.12

### Minor Changes

- Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configProvision`, `config.gate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authProvision` and `auth.verify` trail for runtime authorization checks
  - **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured event tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for provision and composition updates

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.12
