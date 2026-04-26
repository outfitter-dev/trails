# Rule Design

How we author rules — warden rules, lint rules, agent rules — so they hold up over time. This doc applies to **existing rules** (audit through this lens) AND **new rules** (draft through this lens). It surfaces early because it shapes everything downstream.

## TL;DR

Express rules as **invariants** the framework holds, not as **instances** of bugs we found.

> Don't write *"MCP must call `mapTransportError`"*. Write *"any registered transport error map must be consumed by its surface."* The first rule catches one bug. The second catches the same bug **plus every future drift of the same shape**. Both are deterministic; the second is durable.

When invariant-level expression is feasible, prefer it. When it isn't, accept the instance form and mark it explicitly so we know to revisit when the family grows.

The deepest form of "deterministic > vibes" is **deterministic AND derived from authoritative data the framework already owns.** Rules consume framework knowledge from owner modules; they don't re-encode it.

## Why this matters

Every rule is a forever commitment unless we deliberately expire it. Rules accumulate. Stale rules generate noise; noisy rules get ignored; ignored rules let regressions land.

The hardening pass is finding many similar bugs because the rules that would have caught them never existed — and it's surfacing candidate rules with the same generality problem. If we encode *"MCP must do X"* today, we'll write *"WS must do X"* tomorrow when WebSocket lands. Both rules say the same thing in a less-general voice. Worse, they can drift from each other.

The dogfooding insight applies recursively: **the framework derives behavior from owner-held contracts. So should our rules.** Authored rules duplicate framework knowledge. Derived rules read it.

## The core move

Two ways to write the MCP error-map rule:

**Instance form (instance-of-bug):**

```ts
{
  name: 'mcp-error-map-not-consumed',
  description: "MCP handler must call mapTransportError('mcp', err)",
  // ...mechanism-coupled scan
}
```

**Invariant form (invariant-of-framework):**

```ts
{
  name: 'registered-error-map-not-consumed',
  invariant: 'Any surface that registers an entry in transportErrorMap must consume it in its error path.',
  readsFrom: 'transportErrorMap',
  // ...imports the owner export, asks "for each entry, does the corresponding surface consume it?"
}
```

What changed:

- **Name describes the violation, not the missing call.** "Registration without consumption" survives renaming.
- **Reads owner source at scan time.** The rule doesn't list surfaces inline; it reads `transportErrorMap`.
- **New surface registers → automatically covered.** No new rule when `ws` is added.
- **Mechanism rename works.** If `mapTransportError` becomes `surfaceErrorFor`, the rule still asks the right question (consumption), just at a new symbol.

The same move applies to most of our scanner candidates. Some are already invariant-form; others need promotion.

## The survival heuristic

Apply these five tests to any candidate rule. Failing any is a signal — generalize, or accept the limitation explicitly.

### 1. Mechanism-renamed test

If the framework renames its helpers tomorrow, does the rule still work?

A rule that names a function by symbol (`mapTransportError`) fails. Re-express in terms of *roles* ("consumer of `transportErrorMap`") instead of *names* ("call site of `mapTransportError`"). Symbols change; roles don't.

### 2. Family test

Can I name 3+ instances of this same shape today? If yes, the rule belongs at the family level.

The MCP error-map bug is one instance of *"registered map not consumed."* `errorNameToCategory` parallel to `TrailsError.category` is another. `transportNames` mismatching `TraceRecord.trailhead` union is another. Three instances → rule lives at the family level.

If you can only name one instance, the rule must declare a binding `retireWhen:` clause with mechanical CI enforcement — or be refused. 'Tag and forget' is not an option; migration banlists accumulate when the entry condition is logged but no exit criterion is enforced. Acceptable `retireWhen:` forms:

- Time-bound: `'after v1.2'`, `'2027-01-01'`
- Code-bound: `'when no consumer imports @ontrails/legacy/foo-bar for 90 days'`
- Issue-bound: `'when TRL-NNN closes'`

CI fires when the condition is met and either auto-retires the rule or fails the build until the rule is removed. A `retireWhen:` clause without a mechanical enforcement path is a comment, not a contract.

### 3. Data-source test

Does the rule re-encode something the framework already declares?

A rule that hardcodes `'cli' | 'http' | 'mcp'` inline duplicates the surface-kind owner. Read the owner export at scan time. Same for retired vocabulary (read the lexicon's Reserved Terms table), error categories (read `TrailsError.category` / `errorClasses`), exit codes (read `codesByCategory`), intent values (read `intentValues`), and CRUD doctrine (read store-owned exports).

This is the dogfooding test for rules: are we authoring framework knowledge into the rule, or reading it from where the framework already has it?

### 4. Surface-extension test

When a new surface, primitive, or extension lands, does the rule extend automatically, or do we write a sibling rule per surface?

If per-surface, raise the level. The right shape is *"any registered surface must satisfy invariant Y"* with the surface registry as input. Same for primitives, extensions, error classes.

### 5. Context test

Is the rule applicable across `external` / `extension` / `internal`, or just one?

This isn't strictly a generalization test — sometimes the answer is genuinely "internal only." But verify the limitation is **principled**, not **accidental**:

- "Framework must use `exitCodeMap`" is principled-internal — external apps don't have an `exitCodeMap` concept.
- "Result.err must wrap typed `TrailsError`" is universal — applies everywhere.
- A rule scoped to internal only because we wrote it that way without thinking is accidental.

## Where rules live: warden or `@ontrails/oxlint`

The methodology applies in both rule homes. The bright line between them is structural, per [ADR-0037: Oxlint Plugin and the Warden Boundary](adr/0037-oxlint-plugin-and-warden-boundary.md):

- **Warden** if the rule needs the topo, derivation, runtime invocation, or cross-trail comparison.
- **`@ontrails/oxlint`** otherwise — file-level rules that can answer their question from a single file's AST plus its imports plus values resolved through owner modules.

Both homes follow this methodology when authoring or auditing rules. The only difference is what the rule has access to at scan time — a topo (warden) vs. a parsed file plus imports (oxlint). Apply the survival heuristic regardless of which home the rule lands in.

The plugin also exposes Trails-aware AST primitives to extension and consumer authors. Rules they write follow this methodology too — the survival heuristic isn't framework-internal.

## Owner-first authority

The framework already has authoritative values for many things — error categories, intent values, CRUD operations, detour caps, exit codes. Rules should read them, not re-encode them.

The mechanism is **owner-first**, per [ADR-0038: Owner-First Authority](adr/0038-owner-first-authority.md). Rules import authoritative data directly from the module that owns the concept. The error class hierarchy owns the error taxonomy. `@ontrails/store` owns CRUD doctrine. `@ontrails/core` owns intent values and detour caps. The methodology operates against those imports.

When a rule needs framework-authoritative data:

1. **Import from the natural owner.** Find the module that owns the concept; import the typed export.
2. **If the owner doesn't expose the data cleanly, strengthen the owner.** Add `as const` runtime arrays alongside type unions. Add static or instance fields to classes when class-hierarchy data needs to be readable. Export class registries when reflection cannot enumerate subclasses.
3. **Generic fallback only when forced.** A generic registry mechanism is reserved for the case of no natural owner + 2+ independent consumers + demonstrated drift. Today, no v1 hardening candidate clears that bar.

This shapes the survival heuristic: a rule's *data-source test* asks whether the rule reads from the owner, not whether the rule consumes a registry.

### Authoring scope

Owner-first authority is a *framework-and-extension* concern. Consumer apps don't author framework authoritative values — their topo is the canonical source for their own data. If a consumer feels they need an authoritative value the framework hasn't given them, that's a framework gap (an owner module that should expose more), not an instruction to start authoring consumer-side. Consumer-local rule data uses rule configuration or extension-owned exports, not framework authority.

### What counts as owner authority?

Anything the framework already declares as authoritative for a concept should be readable at that owner:

| Owner source | Authoritative for |
|---|---|
| `TrailsError` classes plus `errorClasses` / `codesByCategory` | Error taxonomy and surface error-code mappings |
| `intentValues` | Intent union values |
| Store doctrine exports (`crudOperations`, `crudAccessorExpectations`) | CRUD operation set and accessor expectations |
| `DETOUR_MAX_ATTEMPTS_CAP` | Detour retry limit |
| `resultAccessorNames` | Result accessors that imply sync assumptions |
| Lexicon's Reserved Terms table | Retired vocabulary |
| TRL-504 connector descriptors | Extension and surface declarations |
| Capability matrix (once formalized) | Primitive lifecycle expectations |

When a rule cites one of these, it should **read the owner** — not duplicate its contents.

Curated rule data is different. A denylist such as `context-no-surface-types` may be owned by the rule itself when it represents policy curation rather than framework doctrine. The bar for extracting curated data is the same owner-first bar: another independent consumer or demonstrated drift.

### No v1 registry

No `canonicalSource()` helper, TSDoc marker, registry artifact, loader API, or `derivedFrom` rule metadata ships in v1. Those are fallback mechanisms, not the default architecture. Build them only if a future value has no natural owner, has multiple independent consumers, and has already shown drift pressure.

## Family-collapse-by-shape

The family test (test 2) asks whether you can name 3+ instances. As primitives evolve, the same *rule shape* keeps recurring across primitives — and naming the shape lets future rule authors recognize the family before writing the third sibling. Most are graph shapes (cycle, orphan, collision, schema-compat); some are file-local patterns (vocabulary-banned-term, owner-projection-parity).

The recurring shapes seen so far:

| Shape | Form | Examples |
|---|---|---|
| **Declarations-match-usage** | Static declaration on the trail must match runtime usage in the blaze body | `crosses` ↔ `ctx.cross()`; `fires` ↔ `ctx.fire()`; `resources` ↔ `ctx.resource()` / `db.from(ctx)` |
| **Owner-projection-parity** | Derived/projected data must keep reading its owner, not duplicate it. The meta-pattern behind owner-first authority. | `errorNameToCategory` parallel to `TrailsError.category`; CRUD ops duplicated across rules; intent literals hardcoded; `transportNames` parallel to actual surface set |
| **Orphan-X** | Primitive declared but never referenced in the topo | Orphan resource; orphan signal; orphan layer; orphan contour |
| **Cycle-in-X-graph** | Cycle detection across a directed primitive graph | `crosses` cycle; activation cycle; layer dependency cycle |
| **Collision-detection** | Two declarations claim the same routing slot | HTTP route collision; webhook path collision; MCP tool name collision |
| **Schema-compatibility** | Source schema must satisfy consumer schema | Cross input ↔ caller's args; signal payload ↔ source emitter |
| **Vocabulary-banned-term** | Identifier references retired vocabulary | Reads lexicon's Reserved Terms |
| **Declaration-requires-companion** | A registered declaration of kind X requires a companion of kind Y *on the resolved app* — distinct from orphan-X (which is "declared but never used"); this is "consumed but no infrastructure to run it" | Source-kind ↔ materializer; error class ↔ surface code mapping; resource ↔ adapter |

When a new primitive ships and a candidate rule like "orphan signal" gets filed, ask: is `orphaned-{primitive}` parametrized over the topo a more durable rule than authoring `orphan-signal` next to existing `orphan-resource`?

The family-collapse principle: **prefer parametrizing one rule over the primitive than authoring sibling rules per primitive.**

**Caveat:** only collapse when data model, traversal, and diagnostic shape are genuinely shared. English-similar rules can still deserve separate implementations if their false-positive surfaces or severity expectations differ. The shape catalog names *recurring* patterns; it doesn't mandate fusion of every superficially-similar rule.

This is the family test (test 2) applied prospectively — naming the shape catalog lets future rule authors recognize their rule belongs to a family before they write the third sibling.

### Empirical origin

These shapes emerged from two sources:

1. **The existing-rules audit.** Several existing warden rules cluster around these shapes (cross/fires/resource declaration helpers, route-collision checks, vocabulary scans).
2. **In-flight Backlog projects.** Rules filed by Layer Evolution, Typed Signal Emission, and Reactive Trail Activation (TRL-444/447/452/454/461 and others) all instantiate one of these shapes for a new primitive.

Empirical proof of the family test: every one of those filed rules has at least one prior sibling already in the warden inventory. They aren't novel rule shapes — they're the same shape applied to a new primitive.

### When the shape catalog grows

These shapes are working artifacts, not closed. As new primitives and patterns ship, expect new shapes. When you find one:

1. Name it.
2. Add it to the table.
3. If 2+ existing rules now fit the new shape, evaluate them for collapse.

### Vocab rules and scope

The `vocabulary-banned-term` shape applies to **source files** — TS/JS via `@ontrails/oxlint`. It does not extend to documentation files (markdown). Doc vocabulary alignment is an editorial-review concern (docs review, content lint, or a docs-cutover skill), outside the rule-home boundary.

If a retired term needs enforcement in both source and docs, that's two enforcement mechanisms — the oxlint rule covers code, an editorial pass covers docs. Don't conflate them in one rule.

### Word-level rewrites and false positives

When a rule fires on a literal symbol, import path, or word match (vocabulary retirements, migration banlists, banned-symbol rules), scope it to **the role the rule actually owns**, not every textual occurrence.

A rule banning the identifier `handler` (because the framework retired that concept as a synonym for `trail`) should fire on a function or type named `handler` representing the old framework concept — not on identifiers from third-party imports, comment text about unrelated handler patterns, or domain-specific uses where the word means something different (e.g., "event handler" in DOM code, "service worker" elsewhere).

A rule banning imports from `@ontrails/legacy/foo-bar` should fire on imports of that exact path — not on other references to `foo-bar` in unrelated namespaces.

The scoping question for the rule author: **does this token's role overlap with what the rule actually owns?** If a fresh reader would parse the use as an instance of the rule's target, fire. If the same string means a different concept here, don't.

Implementation hints:

- Prefer position-aware AST checks (identifier names in declaration position, type names, import paths) over free-text matches.
- Exclude third-party imports from the rule's scope unless the rule explicitly owns them.
- When the same word legitimately appears in multiple roles, list the rule-owned roles explicitly rather than banning all uses.

This applies generally to any word-level rewrite rule, not just vocab-banned-term — anywhere the framework asks "ban this string," the rule must specify *which uses of the string* are banned.

## Applying this to existing warden rules

Before we add new rules, audit the existing ones through this lens. The audit doesn't have to refactor everything; it surfaces which rules are durable already and which need reframing.

### Audit methodology

For each existing warden rule:

1. **Find a one-line invariant statement.** "What does the framework promise that this rule enforces?" If you can't write the invariant in one sentence, the rule may be enforcing too many things or none clearly.
2. **Run the five survival tests.** Annotate which it passes and which it fails.
3. **Identify owner sources.** What is the rule's data dependency? Is the rule reading from the owner or hardcoding?
4. **Classify:**
   - ✅ **Durable** — passes all tests; no refactor needed
   - ⚠️ **Refactor** — passes most; small changes promote it
   - ❌ **Replace** — instance-level; needs promotion to family level OR explicit retirement tag
   - 🔄 **Merge** — duplicates another rule's invariant; collapse into a single rule

### What to look for in the existing inventory

Likely refactor candidates based on common patterns:

- **Rules that name a specific surface** (CLI / MCP / HTTP) but should apply to "any registered surface"
- **Rules that hardcode lists** (vocab, error names, intent values) that exist as owner exports elsewhere
- **Rules that reference a specific helper by symbol** rather than role
- **Rules that fire only for one primitive** but state an invariant that applies to all
- **Rules whose description starts with "X must..."** where X is a specific name — usually instance-level

### Phased application

Don't refactor everything at once. Phased:

1. **Phase 0 — Inventory.** List existing rules with one-line invariants and classifications. Output: a table.
2. **Phase 1 — Lossless promotions.** Rules that pass tests 1-4 but have a small naming/wording fix. Refactor in place.
3. **Phase 2 — Substantive promotions.** Rules that need to read owner data instead of hardcoding. Requires the owner module to expose that data first.
4. **Phase 3 — Family collapses.** Rules that are siblings of one invariant. Merge into one.
5. **Phase 4 — Acceptance / retirement.** Rules that don't generalize and don't need to. Tag explicitly: `phase: 'v1-hardening'` or `@deprecated`.

## Applying this to new rules

Drafting checklist for any new rule:

- [ ] **One-line invariant.** What framework promise does this enforce?
- [ ] **Survival tests.** Pass all five; if not, document the principled reason or accept and tag.
- [ ] **Owner sources.** Identify what the rule reads. If it reads nothing, why not?
- [ ] **Family check.** Name three instances. If you can't, ask whether the rule belongs.
- [ ] **Context.** Which of `external` / `extension` / `internal` does this apply to? Is the limitation principled?
- [ ] **Retirement criterion.** If the family test fails (only one instance), the rule MUST declare a binding `retireWhen:` clause with mechanical CI enforcement. Soft phase tags are not sufficient — they don't expire.

A rule that doesn't pass the checklist either gets refactored before landing, or gets explicit dispensation with a recorded reason.

## Anti-patterns to avoid

These are signals that a rule is at the wrong level:

- **Rule name references a specific symbol** — `mcp-error-map-not-consumed` references `'mcp'`. Better: `registered-error-map-not-consumed`.
- **Description says "X must call Y"** — coupling to mechanism. Better: "X must satisfy invariant Z" where Z is mechanism-independent.
- **Rule lists framework values inline** — duplicates owner data. Better: read the owner source.
- **Sibling rules per surface / per primitive** — same invariant, different subject. Better: one rule parameterized by owner data.
- **Rule has no owner data dependency at all** — possibly fine, but ask whether one *should* exist. Many invariants implicitly reference framework metadata.
- **Rule fires on a single file** — almost certainly an instance rule. Require a binding `retireWhen:` clause with CI enforcement, or refuse. Tagging for retirement without enforcement leads to permanent cruft.

## How this connects to the rest of the work

- **Bucket 08 (prevention rails)** — every rule listed in bucket 08's accumulated recommendations gets the survival treatment before it lands. This doc is the gate.
- **Story 5 (authored where derivable)** — the meta-pattern this doc operationalizes. Rules following this design *cannot* duplicate framework knowledge.
- **Story 11 (dogfooding)** — rules consuming owner-held framework data is dogfooding at the audit-tooling layer.
- **Forward-looking advocate skills** — `trails-warden-advisory`, `trails-dogfood-check`, etc. become consumers of owner-held framework data too. Their suggestions derive from the same metadata the rules read. Advice doesn't get hardcoded into skill prompts; it gets derived from the framework's own contracts.

## Design cautions

- **When should curated rule data be extracted?** `context-no-surface-types` keeps its denylist because it is policy curation, not duplicated framework doctrine. Extract only if another independent consumer appears or drift is observed.

- **What exactly is the fallback bar?** The owner-first ADR names no natural owner + 2+ independent consumers + demonstrated drift. Keep that bar visible so we don't rebuild a registry by habit.

- **How do we handle false positives in derivation-bypass rules?** Some literal `5`s aren't bypasses of `DETOUR_MAX_ATTEMPTS_CAP`. The rule needs scope ("when in retry-config code") or an explicit rule-local suppression path.

## Cross-references

- [ADR-0037: Oxlint Plugin and the Warden Boundary](adr/0037-oxlint-plugin-and-warden-boundary.md) — establishes the rule-home boundary between warden and `@ontrails/oxlint`
- [ADR-0038: Owner-First Authority](adr/0038-owner-first-authority.md) — establishes owner-module exports as the data source for framework-authoritative rule inputs
