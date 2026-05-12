# Local Review Round 1: Docs/Vocab Lane

Date: 2026-05-12
Branch reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
Scope: TRL-653 and TRL-702 docs/API/agent-guidance TopoGraph sweep and retired vocabulary guard.

## Summary

Round 1 is not clean. I found two P2 issues:

1. TRL-653 leaves an active topo-store workflow telling users to commit only `.trails/trails.lock`, even though ADR-0046 makes `.trails/trails.lock` and `.trails/topo.lock` a committed artifact family.
2. TRL-702 wires the retired-vocabulary guard into `bun run check`, but the rule exempts an entire active bootstrap config file that contains retired root-state paths. That exemption is broader than the plan's named legacy-reset exception and can hide future active drift in that file.

I found no P0/P1 issues.

## Findings

### P2: Pre-deployment workflow omits `.trails/topo.lock`

Owning branch: TRL-653 (`trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph`)

Evidence:

- ADR-0046 defines both files as committed artifacts:
  - `docs/adr/0046-lock-v3-artifact-family.md:35-40`
  - Quote: "Lock v3 is a committed artifact family:"
  - Quote: "`-`.trails/trails.lock`is the compact manifest.`"
  - Quote: "`-`.trails/topo.lock` is the serialized `TopoGraph`content artifact.`"
  - Quote: "Both files are generated, committed, framework-owned `.lock` artifacts."
- The active topo-store docs correctly say compile writes both files:
  - `docs/topo-store.md:94`
  - Quote: "Compile the current topo to `.trails/topo.lock` and `.trails/trails.lock`."
- The same active workflow then tells users to commit only the manifest:
  - `docs/topo-store.md:113-116`
  - Quote: "1. Make topology changes"
  - Quote: "2. Compile: `trails topo compile`"
  - Quote: "3. Commit `.trails/trails.lock`"
  - Quote: "4. In CI, verify: `trails topo verify`"

Why this matters:

This is current-facing workflow guidance, not historical context. Following it can leave the inspectable graph content artifact uncommitted while the doc still claims to follow the lock v3 flow. It contradicts ADR-0046's split-manifest doctrine and weakens the blind-agent inspection story.

Recommended action:

Update `docs/topo-store.md` to say commit both `.trails/trails.lock` and `.trails/topo.lock`. Consider wording the verify step as verifying the committed artifact family rather than only the manifest/lockfile.

Validation:

Targeted searches found no other active README/docs workflow with the same exact "commit only `.trails/trails.lock`" instruction. Older accepted ADRs still contain pre-ADR-0046 single-lock wording; see P3 residual note below.

### P2: Retired vocabulary guard has an over-broad active-file exemption

Owning branch: TRL-702 (`trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces`)

Evidence:

- The plan allows historical/migration mentions and names the intentional legacy cleanup seam:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:249`
  - Quote: "Historical release notes, old migrations, accepted ADR history, and superseded scratch plans can mention retired vocabulary when clearly historical."
  - Quote: "The one-cycle legacy reset list in `apps/trails/src/trails/dev-support.ts` may mention old state paths as cleanup targets."
- The plan also says exemptions must be explicit and scoped:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:299-300`
  - Quote: "The legacy reset-file cleanup list in `apps/trails/src/trails/dev-support.ts` is an intentional exemption."
  - Quote: "Exemptions must be explicit and scoped."
- The implemented TopoGraph retired-vocabulary rule excludes a whole active bootstrap config file:
  - `scripts/vocab-cutover-map.ts:123-134`
  - Quote: "`const topographArtifactFamilyRetiredMentionPaths = [`"
  - Quote: "`'apps/trails/src/trails/dev-support.ts',`"
  - Quote: "`'scripts/bootstrap/config.toml',`"
- The audit engine excludes by entire path or directory prefix:
  - `scripts/vocab-cutover-audit.ts:32-38`
  - Quote: "`globallyExcludedPaths.has(path) ||`"
  - Quote: "`path === excludedPath || path.startsWith(`${excludedPath}/`)`"
- The active bootstrap config contains the retired paths:
  - `scripts/bootstrap/config.toml:68-77`
  - Quote: "`[cleanup]`"
  - Quote: "`files = [`"
  - Quote: "`\".trails/trails.db\",`"
  - Quote: "`\".trails/dev/tracing.db\",`"

Why this matters:

The topograph rule reports clean, but it cannot inspect `scripts/bootstrap/config.toml` at all. That file is not a historical changelog, migration doc, accepted ADR, superseded plan, or the plan's named `apps/trails/src/trails/dev-support.ts` reset seam. A future active-target reference to `.trails/trails.db` or `.trails/dev/` in that config would pass the guard silently.

Recommended action:

Narrow the exemption. Options:

- remove `scripts/bootstrap/config.toml` from the rule exclusion and update the config wording/shape so the old paths are clearly treated as legacy cleanup data;
- add line/section-level allowlist support to `scripts/vocab-cutover-audit.ts`, then allow only the `[cleanup].files` legacy entries;
- move the legacy cleanup entries behind a clearly named legacy cleanup source that can be exempted without hiding unrelated active config text.

Validation:

`bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term --json` returned zero matches because of the path-level exemption, not because the active config lacks retired terms.

## P3 Residual Notes

### P3: Older accepted ADRs still have single-lock lifecycle wording

Owning branch: TRL-653, if the team wants total ADR text consistency.

Evidence:

- `docs/adr/0015-topo-store.md:289-294`
  - Quote: "The lockfile (`.trails/trails.lock`) becomes a deterministic text export of the current topo state:"
  - Quote: "`trails topo compile         # Write .trails/trails.lock from the current topo`"
  - Quote: "`trails topo verify          # CI: fail if .trails/trails.lock is stale`"
- `docs/adr/0017-serialized-topo-graph.md:110-123`
  - Quote: "`trails topo compile          # write .trails/trails.lock from current topo`"
  - Quote: "The lockfile is:"
  - Quote: "Checked in to source control. A PR that changes trail contracts produces a lockfile diff."
- ADR-0046 explicitly supersedes the single-file story:
  - `docs/adr/0046-lock-v3-artifact-family.md:147-149`
  - Quote: "ADR-0017 is partially superseded."
  - Quote: "the story is expressed by a manifest plus content artifact instead of one all-purpose lockfile."

Why this is P3:

These are accepted ADR history and the dedicated ADR-0046 supersession note exists, so I would not block the stack on rewriting them. Still, they are easy for an agent to find and quote as current unless they read ADR-0046 first.

Recommended action:

Optionally add short local supersession notes to ADR-0015 and ADR-0017 command/lifecycle sections pointing readers to ADR-0046 for the current two-artifact lifecycle.

## Positive Checks

- `docs/lexicon.md:91-156` now defines `TopoGraph`, `topoGraph`, `topo_graph`, `lock_manifest`, `.trails/state/`, `.trails/cache/`, `.trails/config.local.{ts,js}`, and a retired vocabulary table with replacements.
- `docs/migration/topograph-artifact-family.md:3-12` teaches the current manifest/content/state/cache/config layout, and `docs/migration/topograph-artifact-family.md:56-69` tells old `_surface.json` consumers to read `.trails/topo.lock` through `readTopoGraph()` or typed topo-store views.
- `docs/topo-store-reference.md:171-176` explicitly says `topo_surfaces` is an operational CLI-derived projection and points complete surface detail to saved `TopoGraph` and typed accessors.
- `docs/topo-store-reference.md:192-194` uses `topo_graph` and `lock_manifest` for stored graph/manifest exports.
- `docs/api-reference.md:217-232` lists the current `@ontrails/topographer` TopoGraph/lock/topo-store public API and types.
- `package.json:16` defines `vocab:audit`, and `package.json:38` includes it in `bun run check`.
- `AGENTS.md:90` uses the current generated Warden guide header label: `Guide input command`.

## Validation Run

- `/usr/bin/git branch --show-current` -> `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
- `/usr/bin/git status --short` -> clean before writing this report
- `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term` -> passed
- `bun scripts/vocab-cutover-audit.ts --rule connector-term` -> passed
- `bun scripts/vocab-cutover-audit.ts --rule surface-term` -> passed
- `bun scripts/vocab-cutover-audit.ts --list-rules` -> rule exists and shows the broad `scripts/bootstrap/config.toml` exclusion
- `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term --json` -> `fileCount: 0`, `total: 0`
- `bun run lint:ast-grep` -> passed
- `git diff --check` -> passed before writing this report
- `qmd search "TopoGraph artifact family trails.lock topo.lock"` and `qmd search "SurfaceMap _surface.json .trails/trails.db retired vocabulary"` returned no results from the local qmd index, so I used targeted `rg`/file reads for exact token evidence.

Checks intentionally not run:

- `bun scripts/adr.ts map`: skipped because it writes generated ADR map output and this review is allowed to write only the requested report file.
- `bun run format:check`: skipped because the script builds the private Oxlint plugin before checking and may write build outputs; this review is allowed to write only the requested report file.
