---
id: 52
slug: overlays-one-extension-mechanism
title: Overlays Are the Lock's One Extension Mechanism
status: accepted
created: 2026-07-05
updated: 2026-07-07
owners: ['[galligan](https://github.com/galligan)']
depends_on: [17, 46, 50, 51]
---

# ADR-0052: Overlays Are the Lock's One Extension Mechanism

## Context

### Three channels grew where one belongs

The lock accumulated three separate ways for information that is not core graph structure to reach it, each with its own plumbing:

- **CLI aliases** rode an ad-hoc export convention (`cliAliases` / `trailsCliAliases`) that compile lifted into `deriveTopoGraph` through a dedicated option. Warden's drift check derived a fresh graph *without* that lift, so every alias-exporting app compared dirty against its own committed lock — permanently "stale" the moment it compiled ([TRL-1179](https://linear.app/outfitter/issue/TRL-1179/warden-drift-check-ignores-clialiases-so-alias-exporting-app-modules)).
- **MCP trailheads** never reached the lock in practice. The map passed at the `surface()` call is runtime-correct — the ADR-0050 identity tests pass — but lock-blind: invisible to Wayfinder, invisible to drift detection, un-inspectable by agents reading the committed story ([TRL-1193](https://linear.app/outfitter/issue/TRL-1193/app-authored-mcp-trailheads-have-no-channel-into-the-compiled-lock)). Topography grew a `DeriveTopoGraphOptions.trailheads` declaration option, but nothing on the compile path ever wires it.
- **Adapter facts** (the Cloudflare adapter's deployment metadata) landed as the right shape on the first try: a named, schema-registered, namespace-keyed sheet collected on the compile path, round-tripped byte-preserved when unrecognized, covered by the canonical hash, and readable generically through `trails wayfind --overlay <namespace>` ([#900](https://github.com/outfitter-dev/trails/pull/900)–[#903](https://github.com/outfitter-dev/trails/pull/903)). One gap remained at drafting time: the shipped channel was compile-path-only — Warden's fresh drift derivation did not collect it, exactly the asymmetry the drift-symmetry decision below closes. Wave 2 closed it before acceptance ([TRL-1209](https://linear.app/outfitter/issue/TRL-1209/wave-2-drift-symmetry-compile-and-warden-derive-collect-overlays)): compile and Warden fresh derivation now read `trailsOverlays` through one shared collection function.

The third channel is the tell. It shipped without per-kind plumbing because it is a *mechanism*, not a feature: register a schema, collect through one path, preserve tolerantly, hash canonically. The first two channels are the same shape wearing bespoke plumbing — and the bespoke plumbing is exactly where the bugs live. [TRL-1179](https://linear.app/outfitter/issue/TRL-1179/warden-drift-check-ignores-clialiases-so-alias-exporting-app-modules) is not an alias bug; it is an asymmetric-lifting bug. Any per-kind lift can drift from any fresh derivation that forgets it.

### The category question

What is this mechanism? The lock is a *map* — the compiled, resolved story of a Trails application. The mechanism lays additional, named, provenance-tagged facts over that map without changing the base. Remove the sheet and the base map is still complete and readable. Unknown sheets pass through byte-preserved.

That is an **overlay** in exactly the cartographic sense. The rejected alternatives tell false stories: `segment` implies partition-of-a-route (removing one leaves a gap); `section` implies a storage slot in a container. An overlay's defining property is that it is *additive* — the tolerant reader guarantee is the semantics, not an implementation detail.

## Decision

**`overlay` is the lock's sole extension mechanism.** A named, schema-registered, provenance-tagged sheet of facts laid over the topo. Anything that wants into the lock beyond core graph structure rides an overlay — there is no second channel, and no per-kind lift.

### Grammar

One noun, projected consistently (one write, many reads):

| Position | Name |
| --- | --- |
| Topography type | `Overlay` |
| App-module export (the sole channel) | `trailsOverlays` |
| Lock field | `overlays` |
| Wayfinder read | `wayfind overlay <namespace>` (shipped today as the `--overlay` flag on `trails wayfind`; the positional spelling is the ratified read, riding the `wayfind.overlay` trail's canonical CLI derivation) |
| Surface-naming helper | `surfaceOverlay(...)` |

`trailsOverlays` replaces the pre-rename `trailsContributions` spelling, the `cliAliases` export convention, and the MCP trailheads surface option as the one authored channel.

### The subsumption: aliases and trailheads dissolve into bindings

Aliases and trailheads were never two concepts. Both are *named bindings from a surface's namespace onto trails*. They dissolve into one construct — the `surfaceOverlay`, a well-known overlay in the `surfaces` namespace:

```ts
export const trailsOverlays = [
  surfaceOverlay({
    cli: { ls: 'gear.list', gear: ['gear.create', 'gear.list'] },
    mcp: { snippets: ['snippet.create', 'snippet.get', 'snippet.fork'] },
  }),
  cloudflareOverlay,
];
```

Per-surface keys (`cli`, `mcp`, future `ws`/`http`) map names to `TrailRef | TrailRef[]`, where a `TrailRef` is an exact trail id or a dotted trail-id glob (`snippet.*`) in the existing selector grammar.

**The shape rule keeps it honest:**

- A **scalar** value is a transparent synonym — the old "alias." Same surface entry, same full trail contract, coherence-checked.
- A **list** value is a grouped entry — the old "trailhead." One derived surface entry over the members, member identity preserved at invocation and response.
- **A singleton list stays a group.** Cardinality is not the discriminator; value shape is. A group of one keeps its grouped invocation envelope and does not change contract when member two arrives.

ADR-0050's protections re-key onto the shapes rather than the retired nouns: [converge-without-lying](0050-surface-accommodations-preserve-trail-identity.md#two-axes) governs scalar bindings; [gather-without-merging](0050-surface-accommodations-preserve-trail-identity.md#two-axes) identity preservation governs list bindings. The doctrine is unchanged; only the carrier moved.

The subsumption also makes both capabilities symmetric across surfaces for free: list bindings on CLI are command groups (`app gear list`); scalar bindings on MCP are tool synonyms. The trailhead concept was never MCP-specific — the bespoke plumbing just made it look that way.

### Provenance is the security boundary

Every overlay is tagged with its origin: **app-authored** or **adapter-derived**. Surfaces obey app-authored overlays only. An adapter can contribute facts — informational overlays that Wayfinder reads and drift covers — but can never contribute a binding a surface acts on. The rule is enforced at the consumption site and tested: an adapter-derived overlay in the `surfaces` namespace is refused, not merely warned about.

Without this line, any adapter in the dependency graph could silently rebind surface names onto different trails — a supply-chain lane into every app that installs it.

### Drift symmetry: one collection function

Compile and every fresh derivation (Warden drift, `trails validate`, Wayfinder live loads) collect overlays through the same exported collection path. The committed lock and the comparison graph therefore always carry identical overlay content, and the canonical hash does drift detection generically — no per-namespace drift code, ever. [TRL-1179](https://linear.app/outfitter/issue/TRL-1179/warden-drift-check-ignores-clialiases-so-alias-exporting-app-modules)'s bug *class* (asymmetric lifting) becomes structurally impossible, for every namespace at once.

### The call-site option survives as override-in-context

The MCP surface's call-site map is not deleted; it is re-classed under the [authored-defaults-overridable pattern](../tenets.md#authored-defaults-overridable-in-context). The module overlay is the authored, lockable default; a map passed at `surface()` still works and wins at runtime — and is *visible as an override*: Warden warns when the runtime override diverges from the authored overlay. This is a permanent feature of the model, not a compatibility bridge.

### Vocabulary rulings

- **`alias` and `trailhead` demote to prose.** They survive as teaching vocabulary ("a trailhead is a name bound to several trails") and namespace-level strings, not as API identifiers or core concepts.
- **`layer` keeps its name.** It is the ecosystem's standard noun for the wrap-what-runs concept, with no better successor. The contrast pair for the lexicon: **layers wrap what runs; overlays enrich the map.** Layer↔overlay adjacency goes on [TRL-1128](https://linear.app/outfitter/issue/TRL-1128/post-reset-vocabulary-re-audit-detour-fires-transpose-survey-evidence)'s evidence-gated watch list, not into a rename.
- **Lexicon reservation:** an `overlay` is never a subdivision of an individual trail. The lexicon also records the known homophone hazard in the `trails*`-prefix export family (`trailsOverlays` reads as "trails overlays" and as the `trails` prefix + `Overlays`).

### Natural altitude extends to vocabulary

[ADR-0051](0051-package-ownership-follows-natural-altitude.md) says a reusable capability lives in the lowest package where it is coherent. This ADR extends the doctrine from code to *concepts*: a vocabulary item belongs to the package that acts on it. `@ontrails/cli` owns what a `cli` binding means; the MCP projection owns what an `mcp` binding means; core and topography know only the overlay envelope — determinism, tolerant preservation, provenance, hash coverage. Adding accommodation kind N+1 is a schema plus a consumer; core diffs zero lines.

### Hard cutover

The legacy channels are deleted, not deprecated: the `cliAliases`/`trailsCliAliases` export convention, `DeriveTopoGraphOptions.cliAliases`, the never-wired `DeriveTopoGraphOptions.trailheads` declaration option (the `surfaces` overlay's list bindings are the lock-visible carrier; Wayfinder's trailhead facts project from them), and the per-kind compile lifts. There is zero external adoption — the only consumers are in-repo, migrated in the same stack through the Regrade export-restructure class (locate export → wrap into `surfaceOverlay` → move into `trailsOverlays`), so the migration commits carry regrade plan/history evidence and future adopters crossing any pre-1.0 gap inherit the same one-command migration. A leftover legacy export is a Warden **error** naming the rewrite — there is nobody to deprecate for.

## Anticipations

Two adjacent pressures, answered in advance so they do not grow channels:

- **Input mappings are a future field family, not a binding shape.** ADR-0050's third accommodation (surface-shaped input normalizing into the same contract) does not fit `Record<name, TrailRef | TrailRef[]>` — it is per-binding *configuration*, not a name-to-trails edge. When it lands it extends the surface overlay schema with fields; it does not get a new mechanism.
- **If layer declarations ever need lock visibility, they ride an overlay.** No fourth channel.

## Non-goals

- No back-compat shims of any kind — there is no adoption to protect.
- No `layer` rename (evidence-gated per [TRL-1128](https://linear.app/outfitter/issue/TRL-1128/post-reset-vocabulary-re-audit-detour-fires-transpose-survey-evidence)).
- No input-mappings implementation in this wave.
- No changes to what informational overlays (Cloudflare) already do — they shipped correctly; only the noun changed (Wave 0 renamed `sections`→`overlays` on the unmerged stack, so the wrong words never existed in a release).

## Consequences

### Positive

- One mechanism to learn, govern, and test: schema registration, tolerant preservation, provenance, and hash coverage are written once and inherited by every namespace.
- The [TRL-1179](https://linear.app/outfitter/issue/TRL-1179/warden-drift-check-ignores-clialiases-so-alias-exporting-app-modules) bug class is structurally impossible: drift is computed over content one shared collector produced.
- MCP trailheads become lock-visible for the first time (closing [TRL-1193](https://linear.app/outfitter/issue/TRL-1193/app-authored-mcp-trailheads-have-no-channel-into-the-compiled-lock)): Wayfinder, drift, and agents read the same authored bindings the runtime obeys.
- Capabilities symmetrize across surfaces for free: CLI command groups and MCP tool synonyms arrive from the same shape rule with no new plumbing.
- The provenance boundary turns "adapters can't rebind surfaces" from convention into an enforced, tested property.

### Tradeoffs

- The shape rule makes value shape semantically load-bearing: `'gear.list'` and `['gear.list']` mean different things. This is deliberate (it is what keeps a growing group honest) but it is a rule authors must learn; the lexicon and the coherence rules carry the teaching load.
- Hard cutover means any not-yet-migrated in-repo consumer breaks loudly at compile/Warden rather than limping. Accepted: the same stack migrates them via Regrade.
- `trailsOverlays` joins an export-name family with a known homophone hazard; documented in the lexicon rather than solved with a worse name.

### Risks

- Layer↔overlay confusion in teaching material. Mitigation: the contrast pair ships in the lexicon and AGENTS.md; [TRL-1128](https://linear.app/outfitter/issue/TRL-1128/post-reset-vocabulary-re-audit-detour-fires-transpose-survey-evidence) watches for real-world evidence.
- The `surfaces` namespace becomes a high-value target for tooling assumptions. Mitigation: consumers read it through the registered schema, never by duck-typing lock JSON.

## Non-decisions

- The concrete field design for input mappings (deferred until the third accommodation family has a driving use case).
- Whether `ws`/`http` binding keys ship before those surfaces stabilize.
- Any adapter-facing API for *proposing* (not authoring) surface bindings for app review.

## References

- [Design: overlays — one extension mechanism, and the migration semantics for cliAliases + MCP trailheads](https://linear.app/outfitter/document/design-overlays-one-extension-mechanism-and-the-migration-semantics-be1578213cd9) — the ratified binding spec this ADR records
- [ADR-0050: Surface Accommodations Preserve Trail Identity](0050-surface-accommodations-preserve-trail-identity.md) — amended: the accommodation doctrine stands; its implementation story re-keys from named machinery (alias maps, trailhead maps) onto binding shapes
- [ADR-0051: Package Ownership Follows Natural Altitude](0051-package-ownership-follows-natural-altitude.md) — extended: natural altitude now governs vocabulary, not just code
- [ADR-0017: Serialized Topo Graph](0017-serialized-topo-graph.md) — the lock promise overlays extend
- [ADR-0046: Lock v3 Artifact Family](0046-lock-v3-artifact-family.md) — the artifact family the `overlays` field lives in
- Shipped mechanism evidence: [#900](https://github.com/outfitter-dev/trails/pull/900), [#901](https://github.com/outfitter-dev/trails/pull/901), [#902](https://github.com/outfitter-dev/trails/pull/902), [#903](https://github.com/outfitter-dev/trails/pull/903) (generic namespaced overlays: registration, compile-path collection, tolerant reader, canonical hash, generic wayfind read)
- [TRL-1179](https://linear.app/outfitter/issue/TRL-1179/warden-drift-check-ignores-clialiases-so-alias-exporting-app-modules) — the asymmetric-lift drift bug this design retires as a class
- [TRL-1193](https://linear.app/outfitter/issue/TRL-1193/app-authored-mcp-trailheads-have-no-channel-into-the-compiled-lock) — the lock-blind trailheads gap this design closes
