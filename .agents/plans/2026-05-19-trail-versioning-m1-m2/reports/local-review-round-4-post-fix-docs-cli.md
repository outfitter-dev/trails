# Local Review Round 4: Post-Fix Docs / CLI

Review lane: ADR/doctrine/lexicon/blaze language plus CLI namespace/stale-command sweep.

Reviewed from stack tip branch `trl-116-run-examples-and-testall-across-live-version-entries` at cwd `/Users/mg/Developer/outfitter/trails`.

## Summary

No P0, P1, or P2 findings.

The round-1 P2 is fixed: accepted/current ADR snippets now use `trails compile` and `trails validate` instead of teaching `trails topo compile` / `trails topo verify` as current workflow. The live CLI exposes `compile` and `validate` as top-level commands, and `topo --help` lists only `history`, `pin`, and `unpin` children.

Two P3 cleanup items remain. Neither revives the old command surface as runnable current guidance.

## Findings

### P3: ADR-0048 still links ADR-0008 to the ADR index

Evidence:

- `docs/adr/0048-trail-versioning-v3.md:327` links `ADR-0008: Deterministic Surface Derivation` to `README.md`.
- `docs/adr/README.md:17` shows the canonical ADR-0008 target is `0008-deterministic-trailhead-derivation.md`.

Fix recommendation: change the ADR-0048 reference target from `README.md` to `0008-deterministic-trailhead-derivation.md`. The filename still contains historical `trailhead` vocabulary, but the rendered ADR title is the current surface terminology.

### P3: Residual non-command prose still says "topo compile" / "compile, verify"

Evidence from `rg -n 'topo compile|topo verify|compile/verify' ...`:

- `docs/index.md:37` describes Topographer as owning "topo compile helpers".
- `docs/adr/0017-serialized-topo-graph.md:171` has the tradeoff heading "Requires topo compile to stay current."
- `docs/adr/0018-signal-driven-governance.md:259` references ADR-0017 for "topo compile, verify, and lockfile-as-projection semantics."
- `docs/adr/decision-map.json:1321` carries the same generated context from ADR-0018.

These are not explicit `trails topo compile` / `trails topo verify` command instructions, and the command snippets around them are now corrected. Still, they preserve the old compile/verify noun phrase in current-facing navigation/ADR prose.

Fix recommendation: reword to "topo artifact helpers", "Requires compile to stay current", and "topo artifact compilation, validation, and lockfile-as-projection semantics"; regenerate/check the ADR map afterward.

## Verified Clean

- ADR-0048 is accepted and carries the current v3 doctrine: trail-only versioning, top-level `version: N`, sibling `versions`, explicit historical `input`/`output`, pure `transpose:`, fork `blaze:`, projected markers, graph-only `forces`, and top-level CLI namespace (`docs/adr/0048-trail-versioning-v3.md:1`, `docs/adr/0048-trail-versioning-v3.md:10`, `docs/adr/0048-trail-versioning-v3.md:43`, `docs/adr/0048-trail-versioning-v3.md:107`, `docs/adr/0048-trail-versioning-v3.md:124`, `docs/adr/0048-trail-versioning-v3.md:160`, `docs/adr/0048-trail-versioning-v3.md:221`, `docs/adr/0048-trail-versioning-v3.md:260`, `docs/adr/0048-trail-versioning-v3.md:273`).
- ADR-0044 is clearly superseded by ADR-0048 and marks `.v*.ts`, `version.current`, `adapt:`, sunset lifecycle, and `trails version` as no-longer-current doctrine (`docs/adr/0044-trail-versioning.md:5`, `docs/adr/0044-trail-versioning.md:6`, `docs/adr/0044-trail-versioning.md:16`, `docs/adr/0044-trail-versioning.md:21`).
- ADR-0016 has the requested forward pointer: draft `mark()` is not versioning grammar; ADR-0048 uses projected `marker:` identities plus `trails revise` / `trails deprecate` (`docs/adr/0016-schema-derived-persistence.md:14`, `docs/adr/0016-schema-derived-persistence.md:17`).
- ADR index/map are coherent: ADR-0044 is Superseded, ADR-0048 is Accepted, and `bun scripts/adr.ts check` passed with 0 errors and 0 warnings (`docs/adr/README.md:53`, `docs/adr/README.md:57`, `docs/adr/decision-map.json:2460`, `docs/adr/decision-map.json:2463`, `docs/adr/decision-map.json:2603`, `docs/adr/decision-map.json:2607`).
- PR #530 blaze grammar is preserved: the styleguide says a `blaze` establishes the path and the runtime runs the blazed trail, and the lexicon says the runtime runs trails, not blazes (`docs/contributing/language-styleguide.md:16`, `docs/contributing/language-styleguide.md:17`, `docs/lexicon.md:170`, `docs/lexicon.md:178`).
- Versioning lexicon/styleguide guidance matches ADR-0048 and explicitly rejects old versioning shapes (`docs/contributing/language-styleguide.md:275`, `docs/contributing/language-styleguide.md:288`, `docs/contributing/language-styleguide.md:290`, `docs/contributing/language-styleguide.md:298`, `docs/lexicon.md:404`, `docs/lexicon.md:473`).
- Accepted ADR snippets that previously failed now use current CLI grammar (`docs/adr/0017-serialized-topo-graph.md:111`, `docs/adr/0017-serialized-topo-graph.md:113`, `docs/adr/0017-serialized-topo-graph.md:120`, `docs/adr/0017-serialized-topo-graph.md:122`, `docs/adr/0017-serialized-topo-graph.md:162`, `docs/adr/0014-core-database-primitive.md:152`, `docs/adr/0014-core-database-primitive.md:153`, `docs/adr/0015-topo-store.md:292`, `docs/adr/0015-topo-store.md:294`, `docs/adr/0019-hierarchical-command-trees-from-trail-ids.md:61`, `docs/adr/0019-hierarchical-command-trees-from-trail-ids.md:64`).
- Live CLI source registers `compile` and `validate` at top level, and their trail IDs are top-level `compile` / `validate` (`apps/trails/src/app.ts:35`, `apps/trails/src/app.ts:39`, `apps/trails/src/trails/compile.ts:19`, `apps/trails/src/trails/validate.ts:8`).

## Commands Run

- `git status --short --branch` - confirmed stack tip branch `trl-116-run-examples-and-testall-across-live-version-entries` before writing this report.
- `qmd search "trails topo verify trails compile validate ADR-0048"` - no results from the local index.
- Broad `rg` stale-command sweep across docs/apps/packages/plugin/plan packet excluding generated reports found old command/versioning terms only in negative/do-not-use plan guidance, superseded ADR-0044, ADR-0048's retirement sentence, and old draft ADRs.
- Refined `rg` current-facing sweep excluding drafts, ADR-0044, ADR-0048, reports, and plan packet files found no live current-facing hits for `trails topo compile`, `trails topo verify`, old versioning commands, `version.markers`, `adapt:`, `--preserve`, `kind: 'forced'`, `forced markers`, `fork-without-preserved-impl`, or `.v*.ts`; remaining hits were the styleguide's explicit "avoid" list and an unrelated `marked` substring in MCP docs.
- `rg -n 'topo compile|topo verify|compile/verify' ...` found the P3 residual non-command prose listed above.
- `bun apps/trails/bin/trails.ts --help` - shows top-level `compile` and `validate`; no `topo compile` / `topo verify`.
- `bun apps/trails/bin/trails.ts topo --help` - shows `topo` children `history`, `pin`, and `unpin` only.
- `bun apps/trails/bin/trails.ts compile --help` - renders top-level compile help.
- `bun apps/trails/bin/trails.ts validate --help` - renders top-level validate help.
- `bun scripts/adr.ts check` - passed with 0 errors, 0 warnings.
- `git diff --check` - passed.

## Unable To Verify

- I did not verify live Linear issue bodies or remote PR state; this lane was limited to local stack-tip files, local CLI help, and local checks.

## Forbidden Operations

No git or gt write operations were run. No source files were edited. The only file written by this review lane is this report.
