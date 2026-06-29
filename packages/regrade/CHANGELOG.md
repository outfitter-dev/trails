# @ontrails/regrade

## 1.0.0-beta.31

### Patch Changes

- e2f3d23: Default Regrade reports to actionable entries, add skip counts grouped by
  reason, and expose an `includeEntries` option for full report inventories.
- 9be2b7e: Load project-local Warden term-rewrite rules from the Regrade root so repo-owned
  migration classes can run through `trails regrade`.
- 47f782c: Add occurrence-level vocabulary regrade reports with plan, ledger,
  and completion-gate facts. The Trails `regrade` operator command now supports
  positional `<from> <to>` regrade runs and exposes the same capability through
  the curated MCP surface.
- ee9f3ae: Let Warden fix capabilities declare downstream scan targets and have Regrade
  honor those targets for Warden-backed term-rewrite classes.

  Dogfood the first safe facet-to-trailhead prose rewrite through project-local
  Warden rules and Regrade.

- 982a4d7: Add Regrade path-scope exclusion globs for vocabulary runs and expose them
  through the `trails regrade` CLI/MCP contract.
- 1540233: Add Regrade scan inventory summaries that group matched files by extension and
  top-level path, with occurrence counts for vocabulary regrade reports.
- a079073: Rename Regrade path-scope scan controls from `ignore` to `exclude` across CLI, MCP, and project config.
- Updated dependencies [ee9f3ae]
- Updated dependencies [a0126d9]
- Updated dependencies [4cd5d4e]
- Updated dependencies [6a26a08]
- Updated dependencies [38907cc]
  - @ontrails/warden@1.0.0-beta.31
  - @ontrails/core@1.0.0-beta.31

## 1.0.0-beta.30

### Patch Changes

- @ontrails/core@1.0.0-beta.30
- @ontrails/warden@1.0.0-beta.30

## 1.0.0-beta.29

### Patch Changes

- @ontrails/core@1.0.0-beta.29
- @ontrails/warden@1.0.0-beta.29

## 1.0.0-beta.28

### Patch Changes

- @ontrails/core@1.0.0-beta.28
- @ontrails/warden@1.0.0-beta.28

## 1.0.0-beta.27

### Patch Changes

- @ontrails/core@1.0.0-beta.27
- @ontrails/warden@1.0.0-beta.27

## 1.0.0-beta.26

### Patch Changes

- 4e75b85: Carry structured review details from Warden-backed term-rewrite diagnostics into Regrade review reports.
- Updated dependencies [1307568]
- Updated dependencies [ef09e46]
- Updated dependencies [38cd9d6]
- Updated dependencies [f8403c4]
- Updated dependencies [371d19e]
- Updated dependencies [ff48e41]
  - @ontrails/core@1.0.0-beta.26
  - @ontrails/warden@1.0.0-beta.26

## 1.0.0-beta.25

### Patch Changes

- b991263: Retire the package-owned `regrade.downstream.report` trail wrapper so the Trails operator app owns the public Regrade surface while `@ontrails/regrade` exposes the reusable engine APIs and report schema.
- c36aca9: Preserve existing Result error boundaries directly and widen Warden pass-through
  coaching beyond trail blazes.
- 6250729: Expands the public AST guard/accessor surface and migrates Warden/Regrade AST
  consumers onto the typed helpers instead of rule-local node-field casts.
- f757cd7: Publish Regrade's downstream report and AST rewrite APIs, and expose a dry-run
  by default `trails regrade` operator command with explicit apply mode.
- Updated dependencies [a9fdbc7]
- Updated dependencies [f8fd6ca]
- Updated dependencies [0fcc42b]
- Updated dependencies [c36aca9]
- Updated dependencies [f556559]
- Updated dependencies [6250729]
- Updated dependencies [d73c38e]
- Updated dependencies [3befcf1]
- Updated dependencies [a8e4dc3]
- Updated dependencies [a4f9cf6]
- Updated dependencies [9bcf34e]
- Updated dependencies [00c0cf8]
- Updated dependencies [b313c58]
- Updated dependencies [f245fa0]
- Updated dependencies [f1e6efa]
- Updated dependencies [caff950]
- Updated dependencies [df13faf]
  - @ontrails/warden@1.0.0-beta.25
  - @ontrails/core@1.0.0-beta.25

## 1.0.0-beta.24

### Patch Changes

- @ontrails/core@1.0.0-beta.24
- @ontrails/warden@1.0.0-beta.24

## 1.0.0-beta.23

### Patch Changes

- @ontrails/core@1.0.0-beta.23
- @ontrails/warden@1.0.0-beta.23

## 1.0.0-beta.22

### Patch Changes

- @ontrails/core@1.0.0-beta.22
- @ontrails/warden@1.0.0-beta.22

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [99523f2]
- Updated dependencies [5be032c]
  - @ontrails/core@1.0.0-beta.21
  - @ontrails/warden@1.0.0-beta.21

## 1.0.0-beta.20

### Patch Changes

- Updated dependencies [851a2a3]
- Updated dependencies [8bc0708]
- Updated dependencies [6901776]
  - @ontrails/core@1.0.0-beta.20
  - @ontrails/warden@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

- Updated dependencies [e41c382]
- Updated dependencies [1eb5bdc]
- Updated dependencies [f8d80b9]
- Updated dependencies [846a597]
- Updated dependencies [f0f7e2f]
- Updated dependencies [223aaad]
- Updated dependencies [3125f4d]
- Updated dependencies [2494dc6]
- Updated dependencies [120caf5]
- Updated dependencies [2d53717]
- Updated dependencies [16cb740]
- Updated dependencies [8894ecb]
- Updated dependencies [fdf7ec9]
- Updated dependencies [d76be13]
- Updated dependencies [84f56a5]
- Updated dependencies [64fb15a]
- Updated dependencies [431b04c]
- Updated dependencies [5d88104]
- Updated dependencies [f04a9ef]
- Updated dependencies [1c975c3]
- Updated dependencies [48d5ff4]
- Updated dependencies [d5d518e]
- Updated dependencies [216bf10]
- Updated dependencies [678cb1c]
- Updated dependencies [5874fd6]
- Updated dependencies [619cb15]
- Updated dependencies [4642268]
- Updated dependencies [9bab0cf]
- Updated dependencies [3ceeba8]
- Updated dependencies [beafd03]
- Updated dependencies [7b173e0]
- Updated dependencies [6e50e7b]
- Updated dependencies [48edf8d]
- Updated dependencies [12ffa3b]
- Updated dependencies [2f262f7]
- Updated dependencies [58b01f2]
  - @ontrails/core@1.0.0-beta.19
  - @ontrails/warden@1.0.0-beta.19
