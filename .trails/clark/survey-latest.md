## Survey: 2026-04-13

Baseline scan: typecheck clean, tests clean (29 tasks, 58 tests in apps/trails alone), warden reports 6 errors + 6 warnings (triaged below). This is the first survey committed to `.trails/clark/survey-latest.md`, so there is no prior run to diff against.

### Critical (file immediately)

- **ADR-0001 still teaches retired vocabulary.** `docs/adr/0001-naming-conventions.md` line 99 lists `provision()` as the canonical "frozen definition" example, line 100 lists `createTrackerGate()` as a runtime-instance example, and line 187 claims `provision, gate, tracker` are "one vocabulary family." ADR-0023 (status: accepted, April 2026) explicitly retired all four of these terms and said in line 46: "That section of ADR-0001 should be updated in place." The update never landed. Because ADR-0001 is the public naming contract, it is actively misleading contributors and agents reading the accepted ADR trail today. Fix: update ADR-0001 in place to reflect the ADR-0023 lexicon (`resource`, `layer`, `tracing`, `profile`), and add a historical note matching ADR-0001's own precedent for in-place rewrites pre-1.0.

- **`svc` is still the documented parameter name for the `create` factory.** `packages/core/src/resource.ts:30` declares `create: (svc: ResourceContext<C>) => ...` and the TSDoc at line 12 reinforces "passed as `svc.config`." This legacy name (short for "service", retired by ADR-0023 along with `provision`) now propagates everywhere: `docs/resources.md` code examples, `docs/testing.md:379`, `plugin/skills/trails/SKILL.md:129`, and every `__tests__/service*.test.ts` fixture. Every developer who types `resource(...)` gets an IDE tooltip showing `svc`, which is surface-level confirmation of a term the framework has explicitly retired. Fix: rename the parameter (suggested: `ctx` to match the rest of the framework's first-parameter convention, or `res`). This is a low-risk mechanical rename but it touches public TSDoc and every downstream doc.

- **Warden's `implementation-returns-result` rule produces false positives on trail blazes that delegate to Result-returning helpers.** Running `trails warden` flags `apps/trails/src/trails/topo-export.ts:12` and `topo-verify.ts:11` as `implementation-returns-result` errors, but both files correctly `return exportCurrentTopo(app, ...)` where the helper returns `Promise<Result<T, Error>>`. The blaze's return type is already constrained by the type system, which is the tenet's "enforced" tier. Having the warden also flag it — incorrectly — undermines confidence in the rule. This is the `implementations are pure` promise colliding with over-eager static analysis. Two options: (a) relax the rule to accept delegation to functions whose return type is `Result<…>`, or (b) if the rule is intentionally strict, add a warden ignore marker for these two call sites with a justification comment. Option (a) is the right long-term fix because otherwise any helper extraction triggers the rule.

### Important (file this week)

- **`packages/core/src/event.ts` is a post-cutover legacy shim that is still being imported internally.** The file comment reads "Keep this file as a compatibility seam while the repo-wide cutover lands." The cutover PR (`fde5516a`) landed on 2026-04-02, 11 days ago. Meanwhile three internal files (`packages/core/src/draft.ts:4`, `validate-topo.ts:13`, `topo.ts:7`) still import `AnySignal` *through* the shim — `import type { AnySignal } from './event.js';` — instead of from `./signal.js` directly. This is pointless indirection. Separately, the public re-export (`packages/core/src/index.ts:112-113`) surfaces `event`, `AnyEvent`, `Event`, `EventSpec` as public API, directly contradicting ADR-0023's "Event would mislead; signal scopes correctly." Recommend: (a) rewrite the three internal imports to point at `./signal.js`, (b) decide whether the `event` public alias stays as a 1.0 back-compat affordance (document it explicitly and plan its removal) or is deleted now before 1.0 ships.

- **`packages/tracker/` is orphaned post-rename detritus.** The directory contains only a `dist/` folder — no `package.json`, no `src/`, no `.turbo`. The files inside (`tracker-gate.js`, `tracker-accessor.js`, `tracks-layer.js`, `tracker-query.d.ts`, etc.) are compiled output from when the package was named `@ontrails/tracker` and used the old `gate`/`tracker`/`track` vocabulary. The git history confirms the rename to `@ontrails/tracing` and "delete zombie tracker surface" (`a8aa4949`) happened. Nothing references `packages/tracker` in any `package.json`. Fix: `rm -rf packages/tracker/`. Low-risk, mechanical.

- **`connectors/with-jsonfile/` is an empty stub directory.** Contains only `.turbo/` and `node_modules/`. No `package.json`, no `src/`. ADR-0029 lists `@ontrails/with-jsonfile` as a planned future extraction. Currently the functionality lives at `@ontrails/store/jsonfile`. The stub directory is not referenced anywhere. Fix: either delete it or add a `package.json` stub with a `// TODO: ADR-0029 extraction` note so its presence is intentional.

- **`docs/architecture.md` package table is out of date.** The Core Packages Table at line 144+ lists `@ontrails/with-hono`, `@ontrails/http`, `@ontrails/store`, `@ontrails/with-drizzle`, `@ontrails/tracing`, `@ontrails/config`, `@ontrails/permits`, `@ontrails/logging`, `@ontrails/schema`, `@ontrails/testing`, `@ontrails/warden`. That matches reality. But the doc doesn't note `@ontrails/store/jsonfile` as a first-party backend (ADR-0034 says it's shipped and is the proof for the universal accessor contract). Add a row or footnote so agents reading architecture.md learn jsonfile exists.

### Minor (file for backlog)

- **AGENTS.md line 67 uses "metadata" colloquially where the field is `meta`.** "Use `metadata` for annotations and ownership data." The actual field on the `TrailSpec` is `meta`, and the lexicon says `meta`. Small fix: change AGENTS.md to "Use `meta` for annotations and ownership data" so agents don't get the field name wrong. Similar prose drift appears in `docs/trailheads/mcp.md:3`, `docs/trailheads/http.md:120`, `docs/why-trails.md:31/94/150`, `docs/architecture.md:44/107`, `docs/api-reference.md:134/292`. Most of those are using "metadata" as English, which is fine; only flag where it could be misread as the field name.

- **`scripts/vocab-cutover-*.ts` (~1,564 LOC total) are one-shot migration tools.** The cutover PR (`fde5516a`) shipped. `scripts/rename-crumbs-to-tracker.sh` and `scripts/rename-audit.sh` are similar. If the intent is "keep these as historical scaffolding," mark them as such in a top-of-file comment. If they are done, move them to `.agents/scripts/archive/` or delete them — they are currently live paths that typecheck, and they mention retired terms in string literals (`gate`, `middleware`, etc.), which will keep showing up in future vocabulary scans as noise.

- **`packages/core/src/__tests__/service.test.ts` and `service-config.test.ts` use retired `service` vocabulary in file names.** The tests are for `resource()`. Rename to `resource.test.ts` / `resource-config.test.ts`. This is especially visible because the test files will show up on any future repo tour as "services" when the API has been `resources` for weeks.

- **`apps/trails/src/trails/draft-promote.ts:667` has a `_draft.entity.prepare` literal that the warden correctly flags.** This is a hard-coded draft ID for promotion-testing; it may need to be marked as intentional by using the `.draft.ts` trailing segment convention — or moved to a test fixture outside the established source tree. Same pattern in `packages/warden/src/draft.ts:3` and `packages/core/src/draft.ts:10`, which are definitional files that define the `_draft.` marker constant itself. The warden rule should probably learn about the constant-definition case (a one-line ignore or an allowlist for files named `draft.ts`).

### Healthy

- **`gt merge` / trunk-based flow.** 5 recent commits visible on `main`, all merged PRs following the Conventional Commits convention.
- **Tests pass cleanly.** 29 turbo tasks, 58 tests in apps/trails alone, 0 failures.
- **Typecheck is fully cached and clean** (`FULL TURBO`). No `any`, no `as` casts leaking in.
- **Trail/blaze/topo/trailhead vocabulary is consistent** across the current source. The `service/provision/gate/tracker` retirement has mostly landed — the remaining residue is the tail of what ADR-0023 explicitly flagged as rename-churn.
- **Draft state discipline holds.** No `_draft.` IDs in committed topo exports; the warden catches leakage; no `.draft.ts` files are committed beyond the definitional sources.
- **No direct `.run()` calls in trail implementations.** Composition is going through `ctx.cross()` consistently.

### Trends

- **The ADR-0023 vocabulary cutover is ~95% done but the last 5% is concentrated in high-leverage places.** The remaining cases (public `event` alias, `svc` parameter name, ADR-0001 rewrite-in-place, `packages/tracker/dist/` orphan) each have outsized impact because they are on the authoritative surfaces an agent or new contributor reads first: the accepted ADRs, the `resource` public API, the package directory, the public export list. This is a case where "finish the job" yields more value than any new feature would.

- **The warden is maturing but not yet canonical.** Rule coverage is strong (resource-declarations, cross-declarations, fires-declarations, draft-file-marking, detour-refs) but rule *precision* has gaps — the false positives on trails/topo-export and topo-verify are the visible tip. Over time, these false positives either erode trust in the warden or push developers to disable rules. Tightening rule precision is a good week-2 investment.

- **Documentation fidelity lags source.** Architecture tables, lexicon snippets, and TSDoc examples are correct in general posture but carry residual legacy names. This drift is the normal tail of a large rename; the fix is a systematic pass, not a per-file cleanup.

### Linear Issue Candidates

For each Critical/Important item above that warrants tracking, here are the suggested Linear issue drafts (file in TRL):

1. **[Clark: update ADR-0001 in place to match ADR-0023 lexicon]** — labels: `clark-survey`, `docs`, priority: `high`. Update `docs/adr/0001-naming-conventions.md` to remove `provision`, `gate`, `tracker`, `loadout` from the frozen-definition tables and the vocabulary-family list. Follow the in-place rewrite precedent ADR-0001 established for itself.

2. **[Clark: rename `svc` to `ctx` (or `res`) in Resource create factory]** — labels: `clark-survey`, `vocabulary`, priority: `high`. Mechanical rename in `packages/core/src/resource.ts`, cascading through docs/resources.md, docs/testing.md, plugin/skills/trails/SKILL.md, and every `__tests__/service*.test.ts`. Verify: typecheck stays green.

3. **[Clark: warden `implementation-returns-result` false positive on Result-returning delegates]** — labels: `clark-survey`, `warden`, priority: `high`. Relax the rule to accept `return fn(...)` when `fn`'s return type is `Result<…>` or `Promise<Result<…>>`. Or document the suppression pattern. Affects topo-export and topo-verify trails today.

4. **[Clark: delete `packages/core/src/event.ts` legacy shim or document its retention]** — labels: `clark-survey`, `vocabulary`, priority: `medium`. Rewrite three internal imports to go through `./signal.js` directly. Decide on public `event` alias: retire or document.

5. **[Clark: clean up `packages/tracker/` and `connectors/with-jsonfile/` orphan directories]** — labels: `clark-survey`, `housekeeping`, priority: `low`. Mechanical deletion.

6. **[Clark: rename `service*.test.ts` fixtures and update AGENTS.md "metadata" prose]** — labels: `clark-survey`, `vocabulary`, priority: `low`. Vocabulary cleanup tail.

7. **[Clark: archive `scripts/vocab-cutover-*.ts` migration scripts]** — labels: `clark-survey`, `housekeeping`, priority: `low`. One-shot migration scripts keep living in the active source tree and add noise to future vocabulary scans.
