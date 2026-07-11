# PLAN — blaze → implementation

Read `GOAL.md` first, then `.agents/notes/2026-07-06-blaze-readiness-brief.md` (the full occurrence map + registers). This file is the execution plan.

## The registry already half-authors the plan

`packages/warden/src/rules/retired-vocabulary.ts:212-236` (the `v1-blaze-implementation` transition) encodes: `safeRewriteForms = { blaze: 'implementation', blazes: 'implementations' }`, `oldForms = ['blaze','blazes','Blaze']`, `reviewForms = ['Blaze','blazing','blazed','trailblaze']`. Authoring the plan = confirm this, add the rule-logic entries + preserve + scope, then run the regrade class. **Never edit the registry as part of the rename — it IS the tool** (see Hazard 4).

## Five kinds of work

1. **Mechanical field/symbol rename (~1,700 sites).** `blaze:`→`implementation:`, `.blaze`→`.implementation`, `raw['blaze']`→`raw['implementation']`, type-level `'blaze'` key-strings in `Omit`/`Pick` unions → `'implementation'`, `BlazeInput`→`ImplementationInput`. Token/AST-precise — **NEVER substring** (Hazard 2). Tool-applied via the regrade symbol class.
2. **The 6 rule-logic string-checks (Hazard 1) — MUST be authored explicitly; a symbol rename misses them.**
3. **Prose + atomic-flip teaching surfaces.** ~450 doc occ + the grammar-authority docs + mirrored skills.
4. **Idiom PRESERVE** (~31) + the preserve register.
5. **Tier-2 scan-but-never-rewrite** (register in REFS/note).

## Slices (the field type is atomic — see GOAL §Execution posture)

### Slice 1 — CODE CUTOVER (one atomic PR)
The field type on `TrailSpec` changes and every consumer changes with it, or nothing compiles. Do it all in one tool-applied, carefully-reviewed PR:
- Apply the regrade symbol class (kind 1) across `packages/*` + `apps/trails` + fixtures.
- **Hand-verify the 6 rule-logic lines (Hazard 1) are updated** — this is the acceptance-critical bit a symbol rename can't reach.
- **Reconcile the half-migrated Warden rules (Hazard 3)** — their internals key on `'blaze'`; point them at `'implementation'`. Do not create duplicate rules/ids.
- **Resolve the collision surface (Hazard 5)** — lowercase `implementation` locals in `layer.ts`/`execute.ts`; leave the `Implementation`-typed store-CRUD accessor fields (`create/read/update/delete/list`) alone (only `crud.ts:259 blaze?` is in scope).
- Preserve rules protect idioms / `trailblaze` / machinery / tier-2.
- **Gate:** `bun run check` green (proves the type change is consistent), full tests green (proves the rule-logic lines tracked — a warden test that still expects `blaze` detection would fail), `bun run lock:roundtrip` green, changesets for every touched publishable package.

### Slice 2 — DOCS / TEACHING CUTOVER (immediately follows; scope via `--include 'docs/**' 'AGENTS.md' '**/skills/**'`)
Editorial, needs judgment. Prose field-refs → `implementation`; apply the vocabulary decision (keep verb/idiom, retire the "blazed" adjective to plain phrasing). Priority order: the grammar authorities first (`docs/contributing/language-styleguide.md`, `docs/lexicon.md`, `docs/tenets.md`, root `AGENTS.md`, lexicon-defining ADRs 0023/0001/0000), then the mirrored skill cluster (`.claude/skills`, `.agents/skills`, `plugin/skills` — flip all copies together), then the rest. `docs/lexicon-pending.md:11` row moves out of "pending". Generated `dist/*.d.ts` + `docs/adr/decision-map.json` regenerate — do not hand-edit. Same transition record (appended run).

### Slice 3 — RELEASE HYGIENE
Changeset narrative, release note for the cutover, transition-record graduation. Do NOT rewrite historical CHANGELOGs/changesets/accepted-ADRs (tier-2).

### Review inventory (adjudicate within the slices, per GOAL decision)
- "blazed trail" adjective → plain phrasing (not "implemented trail").
- Pipeline **step-label** `'blaze'` (`topo→surface→trail→blaze` stage in traces) → `implementation` for consistency (unless the stage keeps the metaphor — Matt's call; default migrate).
- CRUD **override-container key** `crud(t, r, { blaze: {...} })` (`store/src/trails/crud.ts:167,212`) → `implementation` under full cutover (public API surface — confirm).

## Hazard registers (full detail in the readiness note; the load-bearing ones here)

- **H1 — the 6 rule-logic string-checks (silent governance break):** `warden/src/rules/ast.ts:3260,4141`; `trail-versioning-source.ts:934`; `implementation-returns-result.ts:64`; `apps/trails/.../version-lifecycle-support.ts:545,614`. Plus core runtime probes `trail.ts:400,995,1020`. These key on the literal `'blaze'` and MUST move with the field. Acceptance: `rg "=== 'blaze'|'blaze'\]" packages apps --type ts` returns only preserved-machinery + tier-2 after the migration.
- **H2 — substring corruption:** must be token/word-boundary. `trailblaze`→`trailimplementation`, `blazeParams`/`blazeBody`/`blazeCall`→garbage. The regrade symbol/AST class avoids this; a text find-replace would not.
- **H3 — half-migrated island:** `implementation-returns-result.ts` / `no-throw-in-implementation.ts` / `no-direct-implementation-call.ts` are already named `implementation` but key on `'blaze'`. Reconcile, don't duplicate.
- **H4 — migration machinery = preserve:** `retired-vocabulary.ts` (the registry), its test, the regrade vocab-engine corpora (`regrade/src/downstream/__tests__/vocabulary.test.ts`, `apps/trails/src/__tests__/regrade.test.ts:2799-2908`), the prior `blaze()`→`trailhead` mapping in `scripts/vocab-cutover-*.ts`, and `blaze`-as-codename in `.agents/memory/decisions.md`.
- **H5 — collision surface:** lowercase `implementation` locals (`core/src/layer.ts:53,70,73`, `execute.ts:984,992,996,1156,1164`); store-CRUD accessor `Implementation`-typed fields (leave alone).
- **Tier-2 (scan, never rewrite):** 13 CHANGELOGs, `.changeset/*.md` (esp. `vocabulary-cutover.md`), ~40 accepted ADRs + superseded 0044/0013, release archives incl. `v1-vocabulary-reset.md` (the spec), migration guides, `.agents/plans/**`.

## Acceptance (overall)

The GOAL done-condition, plus: examples in `examples/*` migrate (they carry `blaze:` trail defs); `trails release smoke --check wayfinder-dogfood` green if framework surfaces moved; a Warden rule (or the existing residue mechanism) errors on any reintroduced `blaze:` field post-cutover. The transition record proves occurrence-level completion or leaves a precise, pre-adjudicated review inventory — no broad text-replace as the proof.
