---
id: 23
slug: simplifying-the-trails-lexicon
title: Simplifying the Trails Lexicon
status: accepted
created: 2026-04-07
updated: 2026-04-07
owners: ['[galligan](https://github.com/galligan)']
depends_on: [1]
---

# ADR-0023: Simplifying the Trails Lexicon

## Context

The beta.14 vocabulary accumulated through iteration. Some terms earned their branding by naming concepts that don't exist cleanly elsewhere (`trail`, `trailhead`, `topo`, `blaze`). Others got branded because the work was new and the naming felt exciting at the time (`gate`, `provision`, `loadout`, `tracker`). Over time, a pattern emerged: the terms that earned their keep kept compounding — they taught the framework as you read them. The weaker ones kept requiring explanation in docs, in code review, and in agent onboarding.

Approaching 1.0, this is the last cheap moment to rebalance. After 1.0, every branded term is rename debt across docs, agent prompts, topo exports, and downstream user code. A term that costs a mental-model slot without paying for it is worse than an unbranded noun — it anchors wrong assumptions and silently forks the reader's intuition from the framework's actual behavior.

### Where this came from

Three pressures converged:

- **`gate` kept getting explained as "not just blocking."** Gates are cross-cutting wrappers. Most of them — dry-run, pagination, verbose, telemetry — don't block anything. The word set the wrong expectation, and every doc had to walk it back.
- **`provision` required a paragraph before anyone could write one.** `resource('db', { create, dispose, mock })` reads on sight. `provision('db', …)` reads as "infrastructure jargon, go read the docs."
- **`tracker` was a brand competing with an established industry term.** "Tracing" is what OpenTelemetry calls it, what observability vendors sell, and what every backend engineer already understands. Branding our own word forced every user to learn a synonym for something they already knew.

At the same time, the review surfaced terms that had been treated as compound/derived or plain when they should have been promoted. `pin` carries intent that `snapshot` doesn't. `detour` pairs with `blaze` inside `trail()` in a way `fallback` cannot. `permit` names an artifact that `auth` confuses with a process.

### The missing heuristic

ADR-0001 established our naming conventions but didn't give a single sharp test for when to brand. The review produced one, and it's simple enough to apply in PR review:

**Brand when the standard word would shrink the concept in the developer's mind. Stay plain when the standard word accurately describes the scope and contract.**

Every term below was re-evaluated against that test. This ADR records the outcome and the renames required to get there.

### Why "lexicon"

The current working doc is `docs/vocabulary.md`. But "vocabulary" undersells what the document is. A vocabulary is a word list. A **lexicon** is the curated set of terms, their definitions, and the grammar rules that govern how they compose — the intentional naming system of a language. That is what this document actually is, and calling it what it is reinforces the discipline. Renaming the file is the smallest change in this ADR and the one that best signals the rest.

## Decision

Adopt the simplified lexicon below as the 1.0 naming contract. Rename `docs/vocabulary.md` to `docs/lexicon.md` and update every reference. Apply the brand-vs-plain heuristic as the governing rule going forward.

ADR-0001's grammar rules carry over verbatim, but its enumeration of Trail-native terms (which lists `provision`, `gate`, `tracker`, `track`, and `loadout`) is directly contradicted by the renames below. That section of ADR-0001 should be updated in place, following the precedent set by ADR-0001's own "note on the ADR record" — the project is still pre-release, and rewriting existing decisions in place is cleaner than threading supersession through the ADR history.

### The heuristic

One sentence, applied per term:

> Brand when the standard word would shrink the concept in the developer's mind. Stay plain when the standard word accurately describes the scope and contract.

This means:

- **Brand is an invitation to learn something new.** The branded word signals "your existing mental model is too small for this; recalibrate." It earns its slot by naming a concept the standard word would truncate.
- **Plain is a promise that existing intuition is correct.** The plain word signals "what you already know about this term applies here." It earns its place by not forcing recalibration the framework doesn't need.
- **The mental-model slot is finite.** Every branded term costs a slot. But a standard word that anchors wrong assumptions costs more — it creates invisible confusion that compounds as the developer builds on a misunderstanding. Both sides have a cost. The heuristic picks the smaller one.

### Branded — top-level primitives

Five terms a developer must internalize before reading a Trails app:

| Term | What it is | Why branded |
|---|---|---|
| `trail` | Unit of work. Input, output, intent, contract. | The atomic concept. Everything orbits it. |
| `surface` | Entry point where the outside world reaches trails. | More specific than "endpoint." Says "entry into the trail system." |
| `topo` | Assembles trails into a queryable graph. | More than a registry. The map of everything: trails, relationships, signals. |
| `warden` | Governance and contract enforcement. | Active governance — completeness checking, drift detection, contract validation — not just "linting." |
| `permit` | The resolved identity shape. What auth produces, not the process. | Auth is the boundary work. A permit is the artifact the trail receives: identity, scopes, roles — typed and resolved. |

### Branded — inside `trail()` declarations

Six terms that appear as field names inside `trail()`. The constrained context — alongside `input:`, `intent:`, `output:` — lowers the evaluation bar because the meaning is structural:

| Term | What it is | Why branded |
|---|---|---|
| `blaze` | The implementation field on a trail. | "Blaze a trail" is real English, not manufactured. Only appears inside `trail()`. Short alongside `input:`, `intent:`, `output:`. Alternatives are worse (`impl` abbreviates, `implementation` is a brick). |
| `fires` | Producer-side signal declaration. This trail fires these signals. | "Fire off" is standard English for dispatching. Pairs with `blaze` for vocabulary coherence. Combined with `signal`, the resonance is mnemonic: signal fire. |
| `detour` | Recovery paths when the trail is blocked or fails. | Coherent pair with `blaze`. The trail blazes forward; if blocked, it detours. `fallback` is generic and says nothing about the relationship to the trail. |
| `cross` / `crosses` | Trail-to-trail composition. Declaration and runtime call. | More precise than "compose." `ctx.cross()` says you're invoking another trail. Compact, visual, avoids FP connotations. |
| `signal` | Typed notification primitive with schema, sources, and routing. | Developers would reach for "event." But Trails signals go beyond events: cron triggers, webhook sources, file watchers, bare triggers with no domain payload. "Event" would mislead. |
| `pin` | Named topo snapshot for diffing and verification. | Carries intent that "snapshot" doesn't — "this state is my reference point." Verb-friendly (`trails topo pin`). Precedent in package managers. |

### Plain — standard language

Terms that name concepts existing cleanly across software. The standard word works:

| Term | What it is | Replaces (beta.14) | Why plain wins |
|---|---|---|---|
| `layer` | Cross-cutting wrapper around execution | `gate` | Gates guard. Layers add behavior: dry-run, pagination, verbose, telemetry. Most layers don't block. |
| `resource` | Declared infrastructure dependency with lifecycle | `provision` | `resource('db', { create, dispose, mock })` reads immediately. `provision` required explanation. |
| `profile` | Deployment/environment config set | `loadout` | "Dev profile, staging profile, production profile." Everyone gets it. |
| `tracing` / `TraceRecord` | Automatic execution recording | `tracker` / `Track` | Industry standard term. No explanation needed. OTel alignment. |
| `pattern` | Known operational shape on a trail (toggle, crud, transition) | — (new) | "Feature" collides with product features. Pattern says exactly what it is: a recognized structural form. |
| `run` | Execute a trail | — | Universal. `trails run gist.show` needs no explanation. |
| `store` | Schema-derived persistence | — | Already plain. |
| `projection` | Mechanically derived output from authored data | — | Already plain. |
| `logger` / `logging` | Structured logging | — | Already plain. Framework provides the interface; developers bring their own. |
| `connector` | Third-party integration adapter | — | Already plain. Hono connector, Commander connector, Drizzle connector. |
| `Result` | Ok/Err return type | — | Standard in Rust, Effect, etc. |
| `intent` | What the trail does to the world (read, write, destroy) | — | Already plain. |
| `config` | Configuration | — | Already plain. |
| `meta` | Annotations for tooling and filtering | — | Already plain. |

### Compound and derived terms

Built from the vocabulary above:

| Term | Composed of | Usage |
|---|---|---|
| `pack` | Collection of trails as distributable unit | Trail pack. Published capability bundle. |
| `mount` | Cross-app composition | Mount a remote topo. Future. |
| `survey` | Full introspection of the trail system | `trails survey` to see everything. |
| `guide` | Runtime guidance layer | `trails guide` for recommendations. |

### Migration from beta.14

| Beta.14 | New | Scope |
|---|---|---|
| `gate` / `Gate` | `layer` / `Layer` | Rename + new capability (input schema, three attachment levels) |
| `provision` / `Provision` | `resource` / `Resource` | Rename. API shape unchanged. |
| `loadout` | `profile` | Rename. Config resolution unchanged. |
| `tracker` / `Track` | `tracing` / `TraceRecord` | Merge into core + `@ontrails/observe`. `ctx.trace(label, fn)` replaces `tracker.from(ctx).track(label, fn)` with the same label + function shape. Internal type is `TraceRecord`; developer-facing word is just "trace." |
| `composeGates()` | `composeLayers()` | Follows gate → layer rename. |
| `tracingLayer` | Built-in tracing in `executeTrail` | No longer a separately attached gate/layer. Intrinsic to the execution pipeline. Partially supersedes [ADR-0013](0013-tracing.md)'s "layer plus accessor hybrid" decision — the resource/accessor side remains; the layer side collapses into the pipeline. |
| `fires` (consumer/activation) | `fires` (producer) + `on` (consumer) | Semantic split. `fires:` is now the producer side ("this trail fires these signals"). `on:` is the consumer side ("this trail activates on this signal"). |
| `TRAILS_JSON` / `TRAILS_JSONL` | Derived from topo name (e.g. `STASH_JSON`) | Framework transparency fix. |

### New at 1.0

| Term | What it is |
|---|---|
| `pattern` property on trail | Declared operational shape (toggle, crud, transition) |
| `layers:` on trail / trailhead / topo | Layer attachment at three levels |
| `@ontrails/observe` | Production observability (OTel, dev store, file sink) |

### Vocabulary → lexicon

Rename `docs/vocabulary.md` to `docs/lexicon.md`. Update every reference across docs, ADRs, `AGENTS.md`, `CLAUDE.md`, and agent skills. The word "vocabulary" in prose becomes "lexicon" when referring to the curated, governed term set. The grammar rules from ADR-0001 carry over unchanged — this is the lexicon's grammar:

- **Singular nouns define:** `trail()`, `signal()`, `resource()`
- **Plural fields declare:** `signals:`, `resources:`, `crosses:`, `layers:`, `fires:`, `on:`
- **Runtime verbs are plain actions:** `run()`, `cross()`, `signal()`
- **`create*` for runtime instances:** `createLogger()`, `createConsoleLogger()`
- **`derive*` for derivations:** `deriveFields()`, `deriveFlags()`
- **`validate*` for verification:** `validateInput()`, `validateTopo()`
- **`derive*` then `to*`/`connect*` for surface wiring:** `deriveCliCommands()`, `toCommander()`

## Non-goals

- **Not re-evaluating `trail`, `topo`, or `blaze`.** These are load-bearing and uncontested. They earned their keep in beta and stay.
- **Not introducing a formal deprecation window.** Pre-1.0 means we rename in place. There is no older user base to migrate gradually.
- **Not touching ADR-0001's grammar rules.** The singular/plural/verb grammar carries over verbatim. This ADR extends the naming heuristic and updates the specific term list; it does not replace the conventions.

## Consequences

### Positive

- **Lower onboarding cost.** Four terms that required explanation (`gate`, `provision`, `loadout`, `tracker`) become standard industry words. The lexicon shrinks by the four terms a new developer has to learn cold.
- **Better agent ergonomics.** Agents inspecting a Trails topo encounter `resource`, `layer`, `profile`, `tracing` — words their training data already handles. Fewer synonyms to resolve.
- **OTel alignment.** `tracing` + `TraceRecord` + `ctx.trace()` maps directly to OpenTelemetry terminology. `@ontrails/observe` can adopt OTel semantics without a naming translation layer.
- **Stronger branded terms earn more.** The terms that remain branded — `trail`, `surface`, `topo`, `warden`, `permit`, `blaze`, `fires`, `detour`, `cross`, `signal`, `pin` — are now the full set. Each one names something the standard word would shrink. The signal-to-noise of the branded vocabulary goes up.
- **"Lexicon" reframes the discipline.** Calling the document what it is — a governed naming system with grammar — reinforces that this is a contract, not a glossary.

### Tradeoffs

- **Rename churn across the codebase.** `gate` → `layer`, `provision` → `resource`, `loadout` → `profile`, `tracker` → `tracing` touch every package that used them. Docs, examples, tests, agent prompts, the dogfooding apps. This is the cost of doing it before 1.0 instead of after.
- **Partial supersession of ADR-0013.** The `tracingLayer` → intrinsic-in-`executeTrail` change is a structural collapse, not just a rename. The resource/accessor side of ADR-0013 (how tracing data is stored and accessed) stays. The layer side (how tracing attaches to execution) becomes part of the shared execution pipeline, touching ADR-0006 as well.
- **Loss of vocabulary coherence in a few places.** `composeGates` → `composeLayers` is mechanical. But the `fires` semantic split (producer vs. consumer, with `on:` as the new consumer side) is a real API change that every downstream user of signals has to internalize.
- **`pattern` risks evoking GoF patterns.** A developer reading `pattern: 'toggle'` might think Gang of Four rather than "operational shape." The usage context (a property on a trail declaration) should disambiguate, but this hasn't been field-tested with fresh eyes.

### Risks

- **Third-party content drift.** Any blog post, tutorial, or talk mentioning `gate`/`provision`/`loadout`/`tracker` by name becomes stale. Mitigation: 1.0 release notes call out the renames prominently; the lexicon doc includes a historical migration table for anyone arriving from beta.
- **Partial-adoption windows during the rename PR sequence.** The rename is large enough that it will land across multiple PRs. During that window, some files use old terms and some use new. Mitigation: land the rename as a single stack with mechanical PRs isolated from semantic changes, and run the warden in a checking mode that flags mixed usage.

## Non-decisions

- **Whether `@ontrails/observe` becomes the default tracing sink.** This ADR establishes the naming. The packaging question (in-core default vs. opt-in package) is a separate decision.
- **Whether `pattern` grows beyond `toggle`, `crud`, `transition`.** The initial set is scoped to known operational shapes. Adding more is a future decision, gated by real usage.
- **Scope of the ADR-0001 in-place update.** This ADR calls for updating ADR-0001's Trail-native term list in place. The exact diff — whether it's a one-line update to the enumeration or a broader revision of the surrounding prose — is left to the landing PR.

## References

- [ADR-0001: Naming Conventions](0001-naming-conventions.md) — the grammar rules this ADR extends. Singular/plural/verb conventions carry over verbatim; this ADR adds the brand-vs-plain heuristic and updates the Trail-native term enumeration in place.
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) — the pipeline that absorbs intrinsic tracing when `tracingLayer` collapses.
- [ADR-0013: Tracing](0013-tracing.md) — partially superseded. The resource/accessor side stays; the layer side collapses into the execution pipeline, and `tracker`/`Track` becomes `tracing`/`TraceRecord` with `ctx.trace()` replacing `tracker.from(ctx).track()`.
- [ADR-0009: Resources as a First-Class Primitive](0009-first-class-resources.md) — to be revisited. `provision` → `resource`. API shape unchanged.
- [ADR-0011: Schema-Driven Config](0011-schema-driven-config.md) — to be revisited. `loadout` → `profile`. Config resolution unchanged.
- [Trails Tenets](../tenets.md) — the heuristic here operationalizes "reduce ceremony, not clarity" at the naming layer.
- [Lexicon doc (current)](../lexicon.md) — renamed from `docs/vocabulary.md` as part of this ADR's adoption.

### Amendment log

- 2026-04-16: In-place vocabulary update per ADR-0035 Cutover 3 — `build*` → `derive*` in grammar rules.
- 2026-04-16: Removed `trailhead` from non-goals and branded-terms lists — retired to plain language per ADR-0035 Cutover 3 (`trailhead` → `surface`).
