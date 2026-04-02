# Stash Retro: Synthesized Findings

Two independent reviews of the Stash dogfood retro (19-trail GitHub Gist clone, built overnight by an agent). One from the Trails project co-author (Claude, inside the project context), one from an external reviewer (ChatGPT, given the retro plus docs/ADRs). Neither had direct code access to beta.12.

This document synthesizes both into a single action-oriented reference.

---

## Where both reports fully agree

These findings are high-confidence. Two independent reviewers, same conclusion.

### The core thesis held under real pressure

Both reports call this out as the most important finding. An agent picked up Trails cold, built a 19-trail app with 3 surfaces and 68 tests overnight, and the complaints were about edges, not foundations. The hexagonal model, trail-as-contract, Result/error taxonomy, surface derivation, and examples-as-tests all performed as designed. Neither report identified a structural flaw that would require architectural rework.

### Testing is the crown jewel

Both give it the highest marks. The collapse of examples, validation, contracts, and detours into `testAll(app)` is genuinely best-in-class. The external report calls it "rare air." The internal report notes that going from 0 to 68 tests with essentially zero test-authoring work is the feature that would sell Trails to skeptics. No deductions from either side.

### The error taxonomy is invisibly excellent

Both note that the agent "never once thought about what HTTP status code to return," which is exactly the sign of a well-designed derivation. 13 error classes mapping deterministically to 3 surface representations (exit codes, HTTP status, JSON-RPC codes) eliminates an entire class of drift. The external report correctly observes that the retro undervalues this by not giving it its own score.

### Services already work well

Both reports confirm that `service('stash.db', { create, mock, dispose })` with typed access via `db.from(ctx)` matches the ADR-009 design. Mock factories enabling zero-config `testAll` is working as intended. No gaps here.

### The architecture compounds correctly

19 trails never felt unwieldy. The framework scaled without the developer noticing it scaling. Both reports attribute this to shared execution, deterministic derivation, and the single error taxonomy working together.

---

## The six gaps, ranked by convergent priority

Both reports identified the same core gaps. Here they are in priority order with the combined recommendation.

### 1. CLI complex inputs (P0)

**The problem:** CLI flag derivation breaks for nested objects and arrays of objects. `gist.create` with `files: [{filename, content}]` couldn't be used from the command line. The most visible surface silently degrades on the most feature-rich trail.

**Both reports agree:** The framework already knows when a schema isn't flag-friendly. The fix should be derived, not authored.

**Combined recommendation:**

- Add `--input-json '{...}'` and `--input-file path.json` (with `-` for stdin) as built-in escape hatches
- Detect schema complexity at `buildCliCommands` time and add these automatically
- In `--help` output, indicate when a trail supports structured JSON input
- Do NOT require the developer to opt in. The framework should handle this transparently.

**New metric to track:** CLI representability coverage (percentage of trails whose input schema is fully flag-representable). This would have caught the `gist.create` pain automatically.

### 2. Typed follow (P0)

**The problem:** `ctx.follow()` returns `Result<unknown, Error>`, forcing manual type assertions (`as { ... }`). This is weaker than the typed service story (`db.from(ctx)` is fully typed).

**Both reports agree this is the most important type-system fix.** They diverge slightly on approach:

- **Internal report:** Two-pronged. Near-term: `ctx.follow<TrailOutput<typeof gistShow>>('gist.show', input)` (one generic, non-magical). Medium-term: a typed follow builder that accepts the trail definition object instead of a string ID.
- **External report:** Same two shapes, framed as "pragmatic" (pass trail object for inference) vs "ambitious" (make `FollowFn` topo-aware so string IDs infer types).

**Combined recommendation:** Ship the pragmatic shape first: `ctx.follow(showTrail, input)` where passing the trail object gives you output inference. The string-based `ctx.follow('gist.show', input)` remains as the untyped escape hatch. The warden could suggest the typed form when it detects `as` casts on follow results.

### 3. Composition-only input (P1)

**The problem:** `gist.fork` needs to pass `forkedFrom` to `gist.create`, but that field shouldn't appear in the public input schema. The workaround was adding it to the public schema, polluting CLI flags, MCP tool descriptions, and HTTP parameters.

**This is where the two reports diverge most sharply.**

- **Internal report:** Proposed `followMeta`, a second channel on `ctx.follow()` that's invisible to public surfaces. Intentionally opaque to governance.
- **External report:** Pushes back hard on an untyped hidden bag, calling it "drift in a trench coat." Proposes instead a first-class `followInput` schema on the trail spec, typed and governable:

```typescript
trail('gist.create', {
  input: publicInputSchema,
  followInput: z.object({
    forkedFrom: z.string().optional(),
  }),
  // ...
})
```

**My assessment:** The external report is right on this one. An opaque `followMeta: Record<string, unknown>` violates the "derive, don't hide" principle. A typed `followInput` schema is explicit, governable, and the warden can verify that follow calls match the declared `followInput` shape, the same way it already verifies that follow calls match declared `follow` arrays. The information stays off public surfaces because `followInput` is explicitly a composition-only contract.

**Combined recommendation:** Add `followInput` as an optional typed schema on the trail spec. It's visible to `ctx.follow()` callers, invisible to CLI/MCP/HTTP surfaces, and governable by the warden. This is a new information category: authored, typed, composition-scoped.

### 4. Event `from` validation strictness (P1)

**The problem:** Topo validation rejects `from` references to trails that don't exist yet, forcing bottom-up authoring instead of top-down sketching.

**Both reports agree:** Keep `testAll` strict (its job is truth), but offer a softer mode for authoring/drafting.

**Combined recommendation:** `validateTopo(topo, { unresolvedRefs: 'warn' })` as an option. `testAll` stays strict by default. A draft-oriented mode (perhaps via a flag or a separate `validateDraft()`) lets you sketch the full system top-down and only fail hard in CI.

### 5. Seed data and example fixtures (P2)

**The problem:** Trail examples are static data, but meaningful tests need dynamic state (entities with generated IDs). The agent had to hand-manage deterministic seed IDs in mock factories.

**The reports complement each other well here:**

- **Internal report:** Lean toward blessing the deterministic seed ID pattern as a convention first, deferring a `fixtures` primitive.
- **External report:** Goes further, proposing structured fixture references (`ref('fixture:gist.alice1.id')` or `{ $ref: 'fixture:gist.alice1.id' }`) to keep examples as inspectable structured data, not lambdas.

**Combined recommendation:** Start with the convention (document the deterministic seed ID pattern in testing docs, make it a best practice). If the pattern proves insufficient across multiple dogfood apps, add structured `$ref` fixture references. Do NOT add lambda/callback-based fixtures, as that breaks examples-as-data.

### 6. Composition example coverage (P2)

**The problem:** Composite trail examples can only do schema-only validation because outputs depend on runtime state from downstream trails.

**The reports approach this differently:**

- **Internal report:** Proposed `expectedMatch` (partial/subset assertion) on examples. Keeps examples as structured data.
- **External report:** Proposes a separate `scenario()` concept for multi-step flows, keeping per-trail examples simple and adding app-level journey tests:

```typescript
scenario('fork flow', [
  { call: 'gist.create', as: 'source', input: { ... } },
  { call: 'gist.fork', input: { id: ref('source.id') } },
])
```

**Combined recommendation:** Both. `expectedMatch` is cheap and immediately useful for single-trail partial assertions. `scenario()` is the right answer for multi-step flows and should live in `@ontrails/testing` alongside `testTrail`. They're complementary, not competing.

---

## The one thing only the external report caught

**Friction should become data, not folklore.** The external report makes a sharp observation: the agent hit pain, worked around it, and wrote a smart retro afterward. That's useful but artisanal. Trails should eventually capture friction as structured data the same way it captures schemas and surfaces.

This maps to the "observed" information category in the architecture. Right now, observed information is a future horizon. But the experiment infrastructure should treat friction as first-class structured data from day one, even if the framework doesn't ingest it yet.

---

## What NOT to spend architecture on

Both reports agree on what to deprioritize:

- **`exactOptionalPropertyTypes` friction:** Docs, a warden coaching rule, maybe a helper recommendation. It doesn't get to drag the framework off its centerline.
- **Making `testAll` less strict:** Don't weaken the truth-teller. Add a softer authoring mode alongside it.
- **Overcomplicating examples with statefulness:** Examples should stay simple structured data. Stateful multi-step testing belongs in `scenario()`.

---

## The store/persistence opportunity

The internal report went deep on this across several turns of conversation, resulting in four new ADRs (014-017). The external report didn't cover persistence directly, but its ceremony metrics framework gives us a way to measure the impact.

### The thesis

~30% of Stash's code was store boilerplate: raw SQL, CRUD helpers, pagination logic, type definitions that restated what Zod schemas already described. This is a framework bug by Trails' own standard.

### The design (ADR-014 through ADR-017)

1. **Store Package (014):** Persistence as a right-side hexagonal projection. Zod schemas are the source of truth. The store IS a service. Typed accessors (`conn.gists.insert()`, `.get()`, `.list()`, `.update()`, `.remove()`) are derived from entity schemas plus a bounded set of persistence metadata (primaryKey, generated, indexes, references).

2. **Drizzle Adapter (015):** `@ontrails/store/drizzle` subpath. `deriveTable()` converts Zod to Drizzle column definitions. Drizzle is the query execution engine, not the schema definition layer. Zod flows INTO Drizzle, not the other way around (reversing the typical ORM direction). drizzle-kit handles migrations.

3. **Entity Patterns (016):** Trail factories that produce standard `trail()` definitions from store tables. Seven patterns covering the vast majority of data-centric apps:
   - `entity()` for CRUD (create, show, list, update, remove)
   - `toggle()` for star/like/follow/pin/bookmark
   - `revisions()` for version history
   - `comments()` for threaded comments
   - `scoped()` for "my items" filtered views
   - `derive('clone')` for fork/duplicate
   - `derive('search')` for full-text search

4. **Search (017):** Searchability as a declared property on store entities. FTS is zero-config default. Vector is opt-in with an embedding service. Hybrid combines both via RRF. `entity()` auto-generates a search trail when search is declared.

### Projected impact

| Category | Original Stash | With 014-017 |
| --- | --- | --- |
| Entity schemas | ~300 lines | ~150 lines |
| Store/persistence | ~700 lines | ~30 lines |
| Trail definitions + implementations | ~1,200 lines | ~150 lines (config + examples) |
| Surface wiring + tests | ~50 lines | ~50 lines |
| **Total** | **~2,300 lines** | **~380 lines** |

83% reduction, with every removed line being a restatement of information the framework already had.

---

## The experiment infrastructure

Both reports agree this is powerful and worth investing in. Here's the combined design.

### The core loop

```text
Define experiment -> Agent builds app -> Collect metrics -> Agent writes retro -> Fix framework -> Bump version -> Re-run -> Diff
```

### What to measure

The external report's metrics framework is more detailed and should be adopted:

**Topology metrics:** trail count, event count, service count, follow edge count, examples per trail, percentage with output schemas, percentage with examples.

**Surface leverage metrics:** CLI/MCP/HTTP counts, generated surface artifacts per authored trail, CLI representability coverage.

**Ceremony heuristics (the killer set):**

- LOC inside `trail()`, `event()`, `service()`, `topo()` (contract LOC)
- LOC inside `run:` functions (implementation LOC)
- LOC in persistence/store/domain code
- LOC in surface wiring
- LOC in manual tests outside examples
- Direct imports of surface libraries outside entrypoints
- Ratio: contract LOC / implementation LOC / non-Trails glue LOC

**Friction indicators (warden-style rules):**

- `as` casts on follow results
- Public input fields only used for internal composition
- Hardcoded seed IDs in examples
- Schemas not flag-representable on CLI
- Unresolved event provenance during draft authoring
- Manual JSON parse/stringify workarounds around trail input

### Agent skills (three, not one)

1. **`trails-experiment-build`:** Scaffold, build from prompt, log friction continuously as structured data (not inline comments), never silently work around pain.
2. **`trails-experiment-retro`:** Run tests/typecheck/lint, collect survey counts and surface map, run retro-focused warden rules, produce `metrics.json` and `retro.md` with consistent scoring rubric.
3. **`trails-experiment-compare`:** Re-run same spec on new version, diff metrics and surface map, summarize improvements/regressions.

### Friction as structured data

Prefer an external structured journal over inline source comments. Each friction event:

```json
{
  "ts": "2026-04-01T01:12:00Z",
  "category": "cli-structured-input",
  "severity": "high",
  "trailId": "gist.create",
  "file": "src/trails/gist/create.ts",
  "note": "Array<object> input not representable by derived CLI flags",
  "workaround": "Skipped CLI dogfooding for this trail",
  "frameworkVersion": "1.0.0-beta.11"
}
```

---

## Priority-ordered action list

### Ship before v1.0

1. **CLI `--input-json` / stdin escape hatch.** Highest visibility, clearest path. Derivable from schema complexity. No new primitives.
2. **Typed follow via trail object passing.** `ctx.follow(showTrail, input)` with inferred output type. The string-based form remains as untyped escape hatch.
3. **Soften event `from` validation to warnings.** `validateTopo(topo, { unresolvedRefs: 'warn' })`. Quick fix, immediate improvement to incremental authoring flow.
4. **`expectedMatch` for partial example assertions.** Small surface area, big testing ergonomic win for composite trails.
5. **Document the deterministic seed ID convention.** No new API. Just make the pattern discoverable in the testing guide.
6. **`followInput` typed composition-only schema.** New field on the trail spec. Invisible to public surfaces, visible to `ctx.follow()`, governable by warden.

### Ship in v1.x (post-launch)

1. **Store package (ADR-014) + Drizzle adapter (ADR-015).** The right-side hexagonal projection. Biggest code reduction opportunity.
2. **Entity patterns (ADR-016).** Trail factories for CRUD, toggle, revisions, comments, scoped, clone.
3. **Search (ADR-017).** FTS as zero-config default on store entities.
4. **`scenario()` for multi-step journey testing.** Complements examples-as-tests for composition flows.
5. **Experiment infrastructure.** `trails-experiment-build`, `retro`, `compare` skills. `survey --stats` command. Friction journal convention.

### Track but don't build yet

- Topo-level search (searching trail descriptions and examples for agent discovery)
- Cross-entity search
- Vector/hybrid search (after FTS proves out)
- `warden` friction detection rules (after the friction taxonomy stabilizes across multiple experiments)
- `scenario()` as a first-class primitive vs a testing utility (let usage patterns inform the design)

---

## Bottom line

The retro says Trails is already good enough to matter. The 4.2 is real and the gaps are bounded. None of them point to a broken foundation. Every fix is additive, not architectural. The six items in the "ship before v1.0" list are all doable without changing `@ontrails/core`'s fundamental design.

The bigger opportunity is the store/entity/search stack (ADRs 014-017), which could take a 2,300-line app down to ~380 lines by eliminating the entire category of code where the developer restates information the framework already has. That's the "Trails eliminates the copies" principle applied to persistence, and it completes the hexagonal architecture so both sides of the hexagon are framework-managed.

The experiment infrastructure is the meta-win. It turns dogfooding from an occasional event into a repeatable learning loop where the framework literally measures its own friction and improves against it version over version. That's the kind of thing that compounds.
