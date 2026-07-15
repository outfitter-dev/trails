# Script Graduation

This guide gives Trails contributors and agents one clean rule for whether a behavior belongs in root `scripts/` or graduates into a Trails concept: a package API, an app trail or surface, a Warden rule, a native binding, or an adapter binding. Durable framework behavior must not hide in scripts just because a script was the quickest first implementation.

## The one line

A Trails concept owns the derivation of its own durable facts. Tooling may consume those facts but must never re-derive them. `scripts/` is for repo-as-a-project work and named-exit dogfooding, never for shadow derivation of framework facts.

## Why this bites

Trails is contract-first: the contract is the one source of truth, one write feeding many reads. A script that derives durable framework facts is an ungoverned shadow contract — a second source of truth the framework cannot see, govern, or keep aligned. Script graduation is the contract-first principle applied to our own tooling, not folder tidiness.

## The general heuristic, then the Trails replacement

For newcomers, the ordinary repo heuristic is the toolshed and the house: `scripts/` is the toolshed (things you run *on* the repo), while `src/` and packages are the house (what the repo *is*). Trails is the rare repo where the plumbing is the product domain — release checking, scaffolding, governance, and graph tooling are themselves framework concepts. So "is it plumbing?" is replaced by two questions, asked in order.

## The decision: two questions, in order

### Q1: Whose truth is it?

- **Durable Trails-contract fact** — a concept (trail, surface, error taxonomy, topo, scaffold output, Warden rule set) should own it going forward. Go to Q2.
- **Transient repo fact** — this repo's state, history, build health, or a one-time migration. No concept should own it. **Transient → tooling**: a script, or a contributor package if shared or large. Stop here **even if it derives**.

The transient branch is the case that makes the model click: "derives a fact" is not what forces graduation. A one-off repository cleanup may start as a script even when it uses real AST analysis. The boundary changes when the cleanup becomes a framework contract migration that existing Trails apps should be able to trust. At that point the migration facts must graduate into the Warden/Regrade substrate: Warden detects the contract drift and owns the structured fix metadata; Regrade applies, validates, and routes the change.

That distinction keeps temporary repo tooling from becoming doctrine while still honoring the stable-line promise. A vocabulary cutover script can be a prototype or emergency bridge. A repeatable framework migration path cannot stay there.

### Q2: What is the relationship to the fact, and who is the audience?

- **Derives** the fact → **concept core.** Audience sets the tier: for Trails users, a public surface or rule; for building Trails, a **repo-local** rule or internal command, as with `warden-export-symmetry` and `warden-rules-use-ast`.
- **Consumes** the fact to fill a **declared seam** → a **binding** (see vocabulary below).
- **Consumes** the fact to render concept output → keep a thin **caller** and shrink the script to a call.

The mental model underneath is a 2×2 of *(durable vs transient truth)* × *(serves users vs serves building Trails)*. The first axis decides whether it graduates; the second only sets the public-vs-repo-local tier.

## Binding vocabulary

A **binding** is a concrete realization of an authored Trails declaration or contract against a backend, runtime, tool, surface, or publisher. Use `binding` as the lexicon genus, and prefer qualified forms in prose — `native binding`, `adapter binding`, `surface binding`, `store binding`, `release binding` — so the bare word does not collide with local-variable or import "binding" noise in Warden and source-analysis contexts.

The ADR-0029 dependency-boundary test sets the kind:

- **Native binding** — Trails-owned, built-in path (subpath or same package) that uses only the ambient runtime or a Trails-owned mechanism and crosses no foreign tool or framework boundary. `@ontrails/http/fetch` and `@ontrails/http/bun` are native HTTP bindings. A built-in release publisher is a native release binding.
- **Adapter binding** — an extracted package or integration that crosses into a third-party or foreign framework, tool, or runtime contract. `@ontrails/hono` is an adapter binding. Invoking `@changesets/cli` tool behavior would be adapter-binding territory.
- Merely reading authored input, such as `.changeset/*.md` as release intent, is **neither**. That is just consuming input.

Both kinds may share the **adapter seam**: the paved scaffold plus conformance extension point. The adapter seam is the shared extension and conformance path, not the public noun for every binding — a native binding is not called "an adapter" in prose.

Keep three axes distinct: native vs adapter is the *kind*; subpath/built-in vs extracted is the *placement*; Trails-owned vs foreign-boundary is the *why*. Use "materializer" only when quoting existing HTTP implementation or ADR wording.

## Worked examples

| Behavior | Q1 | Q2 | Home |
| --- | --- | --- | --- |
| release check (`release.check`) | durable | derives, serves users | public surface |
| scaffold version pins (TRL-942) | durable | derives, serves users | public `create` surface |
| public-API example coverage (TRL-943) | durable | derives, serves building Trails | repo-local Warden rule |
| release pack via Bun (TRL-938) | durable | fills seam, ambient runtime | native Bun release binding |
| release registry preflight and publish via npm | durable | fills seam, foreign tool and registry | npm adapter binding |
| packed artifact and Wayfinder dogfood (TRL-939) | durable | consumes, proves release confidence | public `release.smoke` surface |
| changesets-CLI or foreign registry (TRL-938) | durable | fills seam, foreign boundary | adapter binding, extracted |
| `.changeset/*.md` as release intent | durable | consumes authored input | neither — an intent source |
| warden-guide / error-taxonomy doc sync | durable, concept owns it | consumes, renders | thin caller |
| one-off vocab cleanup prototype | transient | not applicable | tooling, may stay as bridge |
| framework contract migration | durable | derives/applies authored contract changes | Warden fix metadata + Regrade |
| trail-input type-cost guard | transient build metric | not applicable | tooling, stays |
| publish/registry npm mechanics | npm facts, not Trails facts | not applicable | inside the binding, never core |

`release.check` is the derives-and-graduates example: release rules are durable Trails-contract facts, so the script-era checker graduated into the `trails release check` surface, and package scripts became thin callers. A one-off vocab cleanup prototype is the derives-but-may-stay-tooling example: real derivation over a transient truth. A stable framework contract migration is different; it must become Warden/Regrade work so detection, repair facts, validation, and review routing stay inside Trails.

The built-in release flow is the fills-a-declared-seam example: `@ontrails/trails/release` owns a native Bun binding for packing and validation plus a same-package npm adapter binding for registry preflight and publication. Root `publish:*` scripts are compatibility wrappers around that flow. They remain useful named exits, but they do not own the release behavior.

## After graduation

Scripts may remain as compatibility wrappers or thin callers after their logic graduates — CI entry points and `bun run` ergonomics are reasons to keep a named exit. Not every script becomes a public CLI command: repo-local Warden rules, internal commands, native bindings, adapter bindings, and plain tooling are all valid homes. The test is who owns the derivation, not whether a file still exists under `scripts/`.

## Review checklist

For any new root script, or a large edit to an existing one, the reviewer asks:

- Does this script derive a durable Trails-contract fact? If yes, it must graduate into the owning concept (public surface, repo-local rule, or binding) and the script may remain only as a thin caller.
