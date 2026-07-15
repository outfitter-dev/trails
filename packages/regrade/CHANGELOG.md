# @ontrails/regrade

## 1.0.0-beta.43

### Minor Changes

- [`4fb20a6`](https://github.com/outfitter-dev/trails/commit/4fb20a68e1ed98972d99fed8b2df96bfa6804bd3): Derive deterministic, provenance-bearing vocabulary plan proposals from a minimal `from`/`to` seed, including morphology, public and compound identifier review, filename and reference-closure candidates, namespace census, and validated live-topo API preserves. Classified governed transitions retain their registry identity while routing every governed form to review instead of inventing a single safe successor.
- [`d3215b0`](https://github.com/outfitter-dev/trails/commit/d3215b0966f13af2a72ece9adbcc2c68c70f81b6): Add governed file renames to vocabulary Regrade plans, with move-first derived reference closure and persisted policy-aware evidence across CLI and MCP.
- [`5a7d22a`](https://github.com/outfitter-dev/trails/commit/5a7d22ab9d674f86b28758f23c3e94a17efb5be1): Add three-tier vocabulary migration scope. Protected historical paths remain
  scanned and counted as `historical-by-policy` without being rewritten, while
  reports expose scope-tier totals and census-expected teaching-surface coverage
  through equivalent CLI and MCP plan schemas. Applied vocabulary occurrences
  remain auditable in history with an `applied` verdict, while policy-only
  evidence does not make an active plan stale merely by being recorded.
- [`88a6a62`](https://github.com/outfitter-dev/trails/commit/88a6a62a9e9e230ca6d368fa78dc3ece6c816204): Complete the v1 classification-first cutover from projection/project vocabulary
  to derive/derived for contract-owned fact production and render/rendered for
  surface presentation. Public type, helper, rule, relation, and report names move
  without compatibility aliases; ordinary repository/project nouns remain
  explicit preserves or structured review inventory.
- [`9f0842e`](https://github.com/outfitter-dev/trails/commit/9f0842ee9d7c7155d86a4fd023760ac0a5636f5d): Retire the temporary root vocabulary-cutover toolchain now that Regrade owns
  structured migration plans, safe rewrites, classification, census, CLI/MCP
  reports, and immutable history. Remove the obsolete source exemptions so
  Oxlint and Warden enforce the durable transition contract directly, and add a
  history-driven Regrade audit surface for current-tree regression checks.
- [`bd1bd96`](https://github.com/outfitter-dev/trails/commit/bd1bd96b90cd8b55f73061e4078a14cd75bed745): Require committed Regrade provenance for governed vocabulary transitions.

  Applied governed plans now expose deterministic transition, plan, source,
  safe-apply, and review-follow-up evidence through history results. Warden loads
  committed history into project context, cites it for reintroduced symbols, and
  rejects invalid or missing provenance for transitions that require Regrade in
  the workspace that owns the governed registry, without making downstream apps
  prove the framework's own migrations.
  Portable validation accepts the authoritative numeric file-rename counters
  persisted by Regrade history.

### Patch Changes

- [`53014a4`](https://github.com/outfitter-dev/trails/commit/53014a4593170edd5adfbaa2c94c895c67a320d1): Exclude immutable Regrade history artifacts from downstream migration source scans while preserving active plan and other policy-classified evidence. Warden continues to validate committed history through its dedicated provenance loader.
- [`18a14e2`](https://github.com/outfitter-dev/trails/commit/18a14e220728be7108f3fe2864455c52305aef9f): Finish the v1 vocabulary reset cleanup by retaining the facet guard, adding a
  durable TopoGraph artifact-family guard, teaching the live lexicon directly in
  agent guidance, and replacing completed reset-family placeholders in public
  Regrade examples and CLI schema help.

## 1.0.0-beta.42

## 1.0.0-beta.41

## 1.0.0-beta.40

### Minor Changes

- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.
- [`aedb87b`](https://github.com/outfitter-dev/trails/commit/aedb87b3b536c5849636c7a5951c51e1e7f0d1cc): Add governed identifier-segment renames for AST-backed migrations. Regrade can
  now migrate camelCase, PascalCase, leading-underscore, and SCREAMING_SNAKE
  identifier segments, including single-segment forms such as `BLAZE` and
  `_BLAZE`, while preserving exact-mode behavior and rejecting lowercase
  substring, concatenated acronym, or inflection matches.

### Patch Changes

- [`01b9204`](https://github.com/outfitter-dev/trails/commit/01b92046db52c71f22a871e58a308d7a94483cab): Harden governed v1 vocabulary transitions with property-key-only blaze literal
  rewrites, structured review for ambiguous literal positions, explicit
  scratch/history boundaries, and scan-only preservation for migration plans and
  historical decision evidence.
- [`6712075`](https://github.com/outfitter-dev/trails/commit/67120754df3f614c7f4dd98be1fa0ba9d69b7765): Complete the v1 hard cutover from the `contour` domain-object declaration
  vocabulary to `entity` across contracts, topo facts, store helpers, Warden,
  Wayfinder, operator surfaces, examples, and generated locks. Existing
  applications must rename contour APIs, run `trails dev reset --yes` to discard
  pre-cutover local Topographer snapshots, and then recompile committed
  `trails.lock` artifacts before upgrading. Those derived snapshots are
  intentionally not read through a compatibility layer.
  The entity-shaped wire contract advances `TopoGraph` and split lock manifests
  from schema version 3 to 4; old split artifacts fail with regeneration guidance,
  while the canonical root `trails.lock` remains schema version 5.
  Wayfinder reports those stale rows as topo-store drift while keeping current
  committed lock facts available for inspection.
- [`35cbe28`](https://github.com/outfitter-dev/trails/commit/35cbe289db46539b3689dbf6cf8ab0e5d9a1b09c): Found `@ontrails/source` as the shared source-code AST kernel for parsing,
  walking, locations, edits, literals, and generic Trails syntax recognition.
  Warden, Regrade, Wayfinder, and the Trails operator now import those shared
  mechanics from `@ontrails/source`; the legacy Warden AST route is removed by the
  stacked hard cutover.
- [`35e5fed`](https://github.com/outfitter-dev/trails/commit/35e5fedd228e498783f479f0dd502e2f3ec772b8): Fold the Wayfinder graph-read catalog into `@ontrails/topography`. Wayfind
  remains the product, trail-id, CLI, and MCP brand, but there is no longer an
  `@ontrails/wayfinder` package to install or import. Programmatic consumers
  should move imports such as `wayfinderTopo`, `wayfindOverviewTrail`,
  `loadWayfinderArtifacts`, and the Wayfinder filter/provenance types to
  `@ontrails/topography`.

  Expose that package move as a governed Regrade transition so exact
  `@ontrails/wayfinder` imports can move safely while product vocabulary and near
  routes remain unchanged for review. Regrade routes package manifests through
  structured review instead of rewriting dependency keys as plain text.

  The Trails operator now reads all `wayfind.*` query trails and artifact helpers
  from `@ontrails/topography` while preserving the existing CLI/MCP schemas,
  route IDs, output shapes, and internal trail visibility.

- [`3a65ae3`](https://github.com/outfitter-dev/trails/commit/3a65ae363e05b7589f4a9876da4346886353b48c): Rename the durable graph substrate package from `@ontrails/topographer` to
  `@ontrails/topography` after folding Wayfind graph queries into that owner.

  Update imports to `@ontrails/topography` or
  `@ontrails/topography/backend-support`. The pre-1.0 cutover does not ship a
  compatibility package. TopoGraph, lock, topo-store, semantic diff, and Wayfind
  APIs keep their existing contracts, and the `trails wayfind` CLI and MCP names
  remain unchanged.

  The governed package-route transition moves legacy `@ontrails/wayfinder`
  imports directly to `@ontrails/topography`; it does not emit the retired
  intermediate `@ontrails/topographer` route.

- [`a45cead`](https://github.com/outfitter-dev/trails/commit/a45cead6e3ddf6ce606bf5e663b74c0d3b5664b8): Make the planned contour-to-entity Regrade transition code-fact complete for
  apply readiness while leaving the repository cutover status planned.
  Identifiers that already contain the target segment now stay in the review
  inventory instead of producing duplicated target names.
- [`8a1ac00`](https://github.com/outfitter-dev/trails/commit/8a1ac00b5d789be41ca6e464358c96b01e442bf4): Govern the exact `@ontrails/warden/ast` to `@ontrails/source` package route
  transition for Regrade string-literal and module-specifier rewrites exposed
  through the Trails CLI and MCP tools. Safe rewrites now require the owning
  manifest to already declare the target package; otherwise Regrade preserves the
  occurrence with dependency repair guidance. Invalid manifests remain unchanged
  and produce structured repair guidance that names the owning manifest. Explicit
  preserve rules remain no-ops before dependency validation, and dotted or
  subpath-like near routes remain deferred instead of becoming invented imports.

## 1.0.0-beta.39

### Minor Changes

- [`65b362f`](https://github.com/outfitter-dev/trails/commit/65b362f65fa2a75e2121d1a8b31882d52fa0376b): Regrade history consolidates per transition, append-only: `regrade apply` appends a run entry stamped `{ planContentHash, lockHashAtRun }` to `.trails/regrade/history/<transition>.json` instead of overwriting lockhash-named files, identical re-runs are recognized as replays, the artifact carries a stable internal transition `id`, and `regrade check <transition>` verifies each recorded run at its own stamped lock. The report `history.status` union widens to `applied | checked | replay`.
- [`d3f7a25`](https://github.com/outfitter-dev/trails/commit/d3f7a25e66b6f0149ab2f33ac31ae1458860dce3): Regrade review entries carry structured review detail through Warden-backed and AST-backed classes: matched form, candidate replacement, machine-readable signals, preserve cautions, and a `judgment` field that distinguishes unresolved occurrence judgment from completed preserve/rewrite verdicts. Safe rewrite entries keep their existing report shape.

### Patch Changes

- [`b077fb7`](https://github.com/outfitter-dev/trails/commit/b077fb7ba6d9724cac6f0e59bc3fec9aec28984c): Add the export-restructure Regrade class family (TRL-1210). `export-restructure:cli-aliases` inverts legacy `cliAliases`/`trailsCliAliases` exports into `surfaceOverlay({ cli })` bindings inside the module's `trailsOverlays` export — adding the `@ontrails/core` import, deleting the legacy export, and routing anything it cannot prove safe (computed keys, spreads, in-module `aliases:` references) to `needs-review` with the exact target shape named. `export-restructure:mcp-trailheads` projects call-site MCP trailhead maps into `surfaceOverlay({ mcp })` group bindings: it rewrites in place when the same module exports `trailsOverlays`, and otherwise emits a classified `needs-review` handoff naming the module-overlay target while the call-site map stays as the richer-metadata override-in-context. Warden's fix-class union grows to `'export-restructure' | 'term-rewrite'`, `no-legacy-cli-alias-export` now advertises the `export-restructure` class, and `loadWardenRegradeClasses` supersedes `loadWardenTermRewriteClasses` (still exported) as the full Warden-routed class loader. Class-mode Regrade also gains the full plan lifecycle: `trails regrade plan --type class --class-ids ...` writes a `.trails/regrade/<slug>.json` plan carrying class ids, scope, and intent, `regrade check` re-runs the dry run and gates on outstanding rewrites or review, and `regrade apply` applies and graduates the plan to `.trails/regrade/history/<slug>-<hash>.json` — the same plan → check → apply → history evidence trail vocabulary regrades already had, now available to structural transforms. The class family ships for downstream apps bridging the pre-1.0 gap, so pre-cutover alias exports and trailhead maps migrate mechanically instead of by hand.

## 1.0.0-beta.38

## 1.0.0-beta.37

### Patch Changes

- [`09f15de`](https://github.com/outfitter-dev/trails/commit/09f15def8fcc8c28b0d604f436e6eeed46da8f37): Stage wide-net Regrade expansion candidates as structured plan review inventory with evidence, status, and pending counts.

## 1.0.0-beta.36

### Patch Changes

- [`6e63e48`](https://github.com/outfitter-dev/trails/commit/6e63e483617b84cb6868d0c4d58d5b5a8d3b9ed2): Complete the v1 grouped surface-entry vocabulary cutover from facet to trailhead, including Regrade dogfood support for governed string literal renames and composed AST rewrite application.
- [`26786a1`](https://github.com/outfitter-dev/trails/commit/26786a14acbe9ed03f69adbdac22968891e33df1): Persist vocabulary Regrade plan artifacts, expose plan/check/preview/apply flows across CLI and MCP, and write applied plan history for reviewed vocabulary migrations.

## 1.0.0-beta.35

### Patch Changes

- [`3842160`](https://github.com/outfitter-dev/trails/commit/3842160ac4030807cb2dfca8e1da75e03febccf2): Teach vocabulary regrades to discover simple prose morphology as deferred
  review inventory so authored plans surface forms like `blazed` and `blazing`.

## 1.0.0-beta.34

### Patch Changes

- [`d67558b`](https://github.com/outfitter-dev/trails/commit/d67558bea3bfa363ed57e0f4091b6eccbf2a7710): Run governed AST symbol renames from the registry-backed `trails regrade` command path, including MCP parity, while preserving derived live API forms.

## 1.0.0-beta.33

### Patch Changes

- [`0c40138`](https://github.com/outfitter-dev/trails/commit/0c40138efb962e779710daa172bdfd756d9d992f): Harden vocabulary regrades by deferring Markdown code contexts for review and
  exposing structured preserve rules through the Trails `regrade` command.
- [`7d65189`](https://github.com/outfitter-dev/trails/commit/7d65189cc33408755fe07a0b5679f1ed01123455): Expose derived live-API preserve inventory in vocabulary Regrade runs and have the Trails operator regrade surface derive current facet API preserves from live topo and MCP surface facts.
- [`fc002d5`](https://github.com/outfitter-dev/trails/commit/fc002d5669f4303427e99f45f9998fd0b0172bdb): Add governed AST identifier rename helpers and Warden residue detection for
  active vocabulary symbol transitions.
- [`6ca0d8f`](https://github.com/outfitter-dev/trails/commit/6ca0d8f776801eee71ddd86cb88c198eaf5815fd): Add a typed governed-vocabulary transition registry that Warden owns and Regrade
  can consume for migration planning.
- [`04bb8a4`](https://github.com/outfitter-dev/trails/commit/04bb8a42af4ada51a74b1d8c83697db92035b5e9): Expose vocabulary Regrade occurrence dispositions and disposition summary counts alongside mechanical verdicts.

  Accept explicit preserve-rule dispositions through the `trails regrade` CLI/MCP contract.

## 1.0.0-beta.32

### Patch Changes

- f3c4fef: Export a shared `escapeRegExp` helper from core and migrate first-party callers off local copies.
- fe72b84: Fold remaining Regrade and Warden scan-target surfaces onto the shared path-scope vocabulary.
- Updated dependencies [3e5c0fc]
- Updated dependencies [f3c4fef]
- Updated dependencies [cb0a9d8]
- Updated dependencies [21c6dda]
- Updated dependencies [fe72b84]
  - @ontrails/core@1.0.0-beta.32
  - @ontrails/warden@1.0.0-beta.32

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
