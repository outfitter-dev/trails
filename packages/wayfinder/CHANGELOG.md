# @ontrails/wayfinder

## 1.0.0-beta.21

### Patch Changes

- 5e301d2: Add a TrailErrorFacts substrate that derives documented and handled trail error facts from saved topo artifacts while preserving explicit provenance and unknown emitted-error completeness.
- 4cca012: Add the `wayfind.errors` graph-read trail and expose it through the Trails CLI for local error-fact inspection.
- 708b861: Expose `wayfind.adapters` over adapter-kit fact reports and add it to the Trails operator CLI Wayfinder surface.
- Updated dependencies [99523f2]
- Updated dependencies [3caa263]
  - @ontrails/core@1.0.0-beta.21
  - @ontrails/topographer@1.0.0-beta.21
  - @ontrails/adapter-kit@1.0.0-beta.21

## 1.0.0-beta.20

### Patch Changes

- f67cd2a: Document Wayfinder as a real graph-read query catalog instead of a shell-only
  package, including MCP exposure guidance, agent skill guidance, and release
  notes for the v0 catalog and its deferred non-goals.
- c65c465: Add the reusable typed Wayfinder entity filter kit for graph-read query trails.
- 38f62f8: Add graph-read `wayfind.nearby`, `wayfind.impact`, and `wayfind.diff` trails over saved Topographer artifacts.
- b248d4a: Add the read-only Wayfinder artifact loader and fact provenance envelope helpers, including cold topo-store schema preflight support.
- 5364df1: Add the v0 graph-read Wayfinder query catalog for overview, search, entity lists,
  describe, and contract inspection over saved Topographer artifacts.
- 2067441: Tighten Wayfinder example filtering so parent trail filters include version examples and exact current-version filters return the entry examples for that version.
- 6c3296c: Refresh the reserved Wayfinder package guidance with the planned v0 query names.
- Updated dependencies [851a2a3]
- Updated dependencies [eee1307]
- Updated dependencies [b248d4a]
  - @ontrails/core@1.0.0-beta.20
  - @ontrails/topographer@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

- Updated dependencies [e41c382]
- Updated dependencies [1eb5bdc]
- Updated dependencies [f8d80b9]
- Updated dependencies [846a597]
- Updated dependencies [223aaad]
- Updated dependencies [3125f4d]
- Updated dependencies [2494dc6]
- Updated dependencies [4bc8a99]
- Updated dependencies [120caf5]
- Updated dependencies [2d53717]
- Updated dependencies [16cb740]
- Updated dependencies [8894ecb]
- Updated dependencies [fdf7ec9]
- Updated dependencies [d76be13]
- Updated dependencies [84f56a5]
- Updated dependencies [653d1fc]
- Updated dependencies [431b04c]
- Updated dependencies [2e76288]
- Updated dependencies [5d88104]
- Updated dependencies [f04a9ef]
  - @ontrails/core@1.0.0-beta.19
  - @ontrails/topographer@1.0.0-beta.19

## 1.0.0-beta.18

### Patch Changes

- @ontrails/core@1.0.0-beta.18
- @ontrails/topographer@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- Updated dependencies [3dc8254]
  - @ontrails/core@1.0.0-beta.17
  - @ontrails/topographer@1.0.0-beta.17

## 1.0.0-beta.16

### Major Changes

- e95c6e3: Scaffold the empty `@ontrails/wayfinder` package shell. Reserves the namespace and gives the v0 wayfinding trails a clean home. The v0 graph-read catalog later shipped in beta.20.

  The `major` bump keeps the package in lockstep with the rest of the `@ontrails/*` workspace: with `initialVersions: "0.1.0"` in `.changeset/pre.json`, a `major` bump computes `1.0.0` on `changeset pre exit`, matching the other framework packages that carry `major` bumps in earlier changesets (`api-simplification-beta4`, `topo-store-relocation`).

### Patch Changes

- Updated dependencies [73622ae]
- Updated dependencies [6300f70]
- Updated dependencies [d172013]
- Updated dependencies [c3fc5c3]
- Updated dependencies [20d7a5c]
- Updated dependencies [be5fb46]
- Updated dependencies [e898cc4]
- Updated dependencies [2bf239e]
- Updated dependencies [3395234]
- Updated dependencies [bcdc484]
- Updated dependencies [3f678d4]
- Updated dependencies [de30d6c]
- Updated dependencies [331e3a9]
- Updated dependencies [c40865a]
- Updated dependencies [4399fdb]
- Updated dependencies [4b8d13b]
- Updated dependencies [4b8d13b]
- Updated dependencies [6be2e95]
- Updated dependencies [819de09]
- Updated dependencies [be08686]
- Updated dependencies [112b9f2]
- Updated dependencies [893025e]
- Updated dependencies [eec5e9d]
- Updated dependencies [ebd4434]
- Updated dependencies [863d473]
- Updated dependencies [344f2f7]
- Updated dependencies [26f9ffd]
- Updated dependencies [b12e19b]
- Updated dependencies [ed7f6f6]
- Updated dependencies [7a1d4a9]
- Updated dependencies [84f595a]
- Updated dependencies [d2cb9ba]
- Updated dependencies [10eae9a]
- Updated dependencies [bbb1ea4]
- Updated dependencies [22c6c06]
  - @ontrails/core@1.0.0-beta.16
  - @ontrails/topographer@1.0.0-beta.16
