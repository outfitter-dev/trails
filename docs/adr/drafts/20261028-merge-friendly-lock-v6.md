---
slug: merge-friendly-lock-v6
title: Merge-Friendly Lock v6
status: draft
created: 2026-10-28
updated: 2026-10-28
owners: ['[galligan](https://github.com/galligan)']
depends_on: [17, 46, 52, 54]
---

# ADR: Merge-Friendly Lock v6

This draft proposes a future lock representation. It does not describe implemented v6 behavior.

## Context

A lock records one app’s resolved contract. Its serialization should let unrelated contract edits remain independent through an ordinary text merge. Whole-graph hashes and stored derived aggregates make independent edits touch shared lines even when their authored contracts do not overlap.

ADR-0054 remains the substrate owner: one runnable app owns one root `trails.lock`, and a workspace view derives from its declared app locks. This proposal extends that serialization and integrity contract. It does not restore the older artifact-family layout or introduce a workspace aggregate lock.

## Decision

Serialize the app lock as independently hashed contract units. Derive aggregate views from those units when reading. Preserve removal and force evidence until the applicable retention contract permits its removal.

Each entry stores a hash of its canonical contract facts with its own hash omitted. Overlay namespaces store `{facts, hash}` envelopes. Activation sources and trailheads are independent units. Hash aggregation binds unit type, key, and hash in canonical order, retaining equal-content units and their multiplicity. An unordered set of content hashes is insufficient because a key or namespace change must remain detectable.

Logical overlay hierarchy uses the existing exact namespace map. `deploy` and `deploy.cloudflare` are separate units; provider facts do not live inside neutral deploy facts. A provider-only edit changes its provider unit while leaving the neutral unit’s facts and hash unchanged.

ADR-0052’s tolerant-reader guarantee survives the envelope change. Validate the generic namespace envelope and canonical hash without requiring a namespace-specific schema. Preserve unknown facts byte-for-byte without reinterpretation, default insertion, narrowing, or normalization; expose them through the normalized read view as uninterpreted facts. Known adapters may validate their own schemas, but installing or omitting one must not erase another namespace. Migration and cold round-trips must retain an unknown namespace’s facts and valid hash coverage.

The header hash material is exactly the app `scope` and the lock schema/format version. It excludes force history, overlays, activation facts, library facts, trailheads, and every derived aggregate. Adding header material requires an explicit revision of this decision. `headerHash` hashes that canonical header with its own hash omitted. The one derived aggregate is SHA-256 of canonical material containing `headerHash` and the sorted `(unit type, unit key, unit hash)` tuples for every entry, overlay namespace, activation source, and trailhead. Sorting and serialization use the shared Topography hash owner; no second aggregate formula is introduced. The stored `topoGraphHash`, `summary`, `activationGraph`, and `library` table are replaced by derived read views only when their owning facts are losslessly available.

A trailhead’s whole-unit hash and its membership hash remain different facts. The serialized unit need not store the redundant membership hash. Read views derive it through the existing member-ordering and hash owner. Description or surface changes affect the unit hash; membership changes affect both.

## Library derivation prerequisite

The existing library derivation consumes the live topo, including effective visibility and live schema conversion. Saved entries do not yet contain every fact it needs. Metadata derivation alone does not preserve explicit visibility.

Before dropping the stored library table, establish lossless owner facts and one shared derivation for live and decoded graphs. Do not reconstruct synthetic trails or Zod objects, invent a parallel eligibility algorithm, or guess that missing historical visibility means public. Older locks may retain their saved library view until an ordinary migration compile supplies the required facts.

Acceptance compares exports and exclusions for default and explicit public trails, explicit internal trails, legacy internal metadata, conflicting public/internal declarations, draft and activation-only trails, missing schemas, represented and transformed schema contracts, collisions, resources, versions, and descriptions. Tombstones never become library exports.

## Removal and force retention

A forced removal leaves an entry shaped as `{id, kind, removed: true, forces: [...]}` with its per-unit `hash`. Keep removal audit on that ID/kind unit rather than a shared graph-level force list. Listing and derived runtime views skip tombstones; integrity and audit readers still inspect them. Account for every carried force during migration, including graph-level obligations that cannot truthfully be assigned to a removed entry. Their lossless placement is a migration gate, not permission to discard them.

A tombstone becomes eligible for removal only after positive evidence that the owning app release contains that removal, followed by a successful ordinary compile of the still-removed contract. Until applicable evidence exists, retain it. The checkpoint representation and release-owner integration are implementation gates.

Evidence must bind app identity, released source or contract, and the particular removal occurrence. A previous release cannot authorize pruning a later removal after reintroduction. A version field, version commit, tag alone, prepared release, or unrelated app or package release does not establish that evidence.

Current inspected force paths carry history across clean compiles. Their force-stripping helpers support comparisons and hashes; they do not implement publication-based pruning. Existing framework package-publication machinery is narrower than a portable owning-app removal checkpoint.

### Force disposition

Support explicit accepted exceptions; the release rule is zero active pending forces, not zero historical records. Each force event, on a live entry or a tombstone, retains its original identity and facts and adds one disposition. On v5 migration, missing disposition becomes active. Legacy `acceptedAt` records when `compile --force` recorded the event; neither it nor a reason proves an accepted exception or resolution:

```ts
type ForceException = {
  owner: string;
  reason: string;
  plannedResolution: string;
  expiresAt: string;
};

type ForceDisposition =
  | { status: 'active'; exception?: ForceException }
  | { status: 'accepted'; exception: ForceException }
  | {
      status: 'resolved';
      exception?: ForceException;
      resolvedAt: string;
      reason: string;
      evidence: {
        kind: 'version-entry' | 'source-fix' | 'released-removal';
        occurrenceHash: string;
        reference: string;
      };
    };
```

The timestamp strings are validated absolute timezone-bearing instants; they are authored evidence, not compile-time timestamps. Evidence must bind the original force identity, app, affected contract and applicable source or removal occurrence. A reference alone is insufficient if the owner cannot verify that binding. Derive `occurrenceHash` through the shared Topography hash owner from canonical material containing app scope and these original event fields: `acceptedAt`, `change`, `detail`, `id`, `kind`, original `reason` (explicit null when absent), `severity`, and `source`. Exclude disposition, exception, and resolution evidence. The original force recording instant participates in identity; changing disposition does not. This derived identity binds resolution and release checkpoints without adding a parallel event identifier or audit store. This digest identifies and deduplicates the recorded facts; it does not prove that a source transition or removal shipped. `acceptedAt` is not independently guaranteed unique. Hash equality alone never authorizes reuse of release evidence after reintroduction or re-removal: the verifier must also bind the actual app, affected contract/source transition, and particular removal occurrence.

An accepted exception requires all four nonempty owner/reason/planned-resolution/expiry fields. It does not resolve the force. Normal schema and integrity validation reject malformed disposition data. Normal readers reject malformed v6 records and produce no normalized graph. A raw recovery classifier may diagnose them conservatively as unresolved, without producing a valid graph, repairing bytes, or granting an exemption. The Warden/release classification below applies to structurally valid records; failed evidence verification or expired exceptions remain unresolved within that valid shape. Warden emits `pending-force` for active events, a distinct visible nonblocking named-exception diagnostic for valid unexpired accepted events, and audit-only history only for resolved events with verified evidence binding. A `resolved` label with missing, unverifiable, or contradictory evidence remains unresolved for Warden, release, and pruning; it cannot grant an exemption. The concrete evidence representation and shared verifier are implementation prerequisites. The release policy must explicitly consume classified active outcomes to enforce zero active forces; warning severity alone does not implement that gate. These are proposed behaviors, not existing gates. Use one explicit trustworthy assessment instant shared by the Warden/release run. `expiresAt <= assessedAt` is expired and effectively active; unavailable trustworthy assessment time cannot grant an exception. Tests inject that instant. Reading after expiry changes diagnostics, never saved bytes or hashes.

A matching real version entry or verified source fix can resolve only the obligation it actually cures. A version bump, successful compile, free-text claim, or later date alone cannot resolve it. The optional `exception` record survives accepted-to-resolved and authored revocation transitions unchanged, preserving the owner, reason, planned resolution, and expiry in the same force event. Direct active-to-resolved transitions have no exception record. An explicit renewal replaces the current exception record and leaves its prior authored form in existing Git history; no new audit archive is introduced. The owning release containing an authorized removal resolves that exact removal force when its applicable release checkpoint is verified. Other obligations on the same tombstone remain. Accepting or renewing an exception cannot resolve an event; expiry returns it to active assessment without rewriting saved state. Revocation is an explicit authored transition back to active, with no external revocation channel. Reintroduction and re-removal create a distinct occurrence whose evidence cannot reuse an earlier release.

A tombstone may be pruned only when every attached obligation is resolved, valid applicable positive release evidence includes that particular removal occurrence, and an ordinary compile confirms it remains removed. A valid accepted but unresolved exception therefore retains the tombstone regardless of expiry. Release assessment must use the same explicit assessment instant as Warden to evaluate expiry; retention bytes never depend on ambient time. The compiler carries dispositions unchanged unless a verified explicit transition/checkpoint is part of its committed inputs. Unknown or malformed release evidence retains the tombstone and reports why. The checkpoint representation and release-owner integration remain required implementation work; the policy above is decided by this draft.

## Vocabulary and namespace governance

`headerHash` means the integrity hash of the non-unit header residue. A per-entry `hash` belongs to one Trails contract unit. A tombstone preserves a removed unit’s identity and audit obligations. `trails resolve` is the planned lock-conflict workflow; it does not mean runtime resource resolution. Keep these meanings aligned with the completed Skillset SET-767 design while preserving each tool’s own schema and field names. SET-767 uses per-item `provenanceHash`; Trails uses `hash` and does not absorb Skillset tooling.

Use `permits.roles` for authored role maps and ceilings. Challenge scopes remain entry facts derived from trail permits; render `scopes_supported` without storing another aggregate. A future stored challenge unit would use `permits.challenges`. MCP skill, cache, and subscription unit names require the MCP owner’s decision before implementation. Existing `cloudflare` readers require an explicit migration to `deploy.cloudflare`.

Unknown namespace tolerance never permits executing unknown facts as bindings. Known consumers require their registered schema and app-authored provenance. Generic validation retains provenance, unknown fields, and unit/aggregate integrity; an unknown dotted namespace must survive read/write and fail a tamper regression. Unsupported lock versions and malformed envelopes fail explicitly rather than being guessed into the tolerant namespace path.

Namespace granularity remains ADR guidance: likely independent features should own separate namespaces. Existing coherence rules may enforce references and envelope shape, while validate and Warden verify unit integrity. A rule cannot infer future PR independence reliably. A new granularity rule requires a concrete mechanically enforceable invariant; this draft does not invent one.

## Migration and verification

Readers accept valid v5 locks and report their representation stale with one `trails compile` command; that ordinary compile writes v6 while preserving audit history. Ship the format in a 0.x minor with changesets for `@ontrails/topography`, `@ontrails/warden`, and `@ontrails/trails`. Unreadable or unsupported locks remain fail-closed; force does not bypass recovery. Document the migration command and package release intent before adoption.

The primary proof is an unrelated-public-trail pair: compile each independent edit, merge the resulting lock changes, and compare with a fresh compile of the merged source byte for byte. Add key and namespace rename or swap cases, equal-content units, own-hash exclusion, provider independence, and corruption localization.

Verify library and activation read parity, membership ordering, workspace hash derivation, Wayfinder and Warden integrity, and all seven cold lock round-trips. Retention cases cover before release, version-only and unrelated releases, an applicable release, repeated cold compiles, reintroduction and re-removal, and active, accepted, expired, and verified resolved forces. Cover direct active-to-resolved, accepted-to-resolved with retained exception evidence, explicit renewal and revocation, expiry without byte rewrites, malformed normal-read rejection versus recovery-only diagnosis, and occurrence binding across reintroduction and re-removal.

## Decision lineage and acceptance gates

This proposal extends ADR-0054, retaining ADR-0017’s durable graph and ADR-0046’s Topography ownership as historical lineage. TRL-995’s disposition ledger must retain the draft and repoint its amendment lineage to the surviving accepted owners; it must not imply that this proposal is accepted.

TRL-1423, TRL-1419, and TRL-1418 govern immediate lock recovery and conflict resolution. Drafting may proceed while those changes settle. Linear reports SET-767 Done on October 27, 2026, satisfying its tracker-level completion condition; this draft does not independently prove its package/runtime delivery. Verify vocabulary parity against that completed implementation before ADR acceptance; local Skillset adoption under TRL-1422 remains separate because this repository still pins 0.27. Local adoption is not an additional prerequisite for this ADR. Acceptance requires the remaining checkpoint and vocabulary verification gates. TRL-1114 must land before v6 implementation, which requires its own issue after acceptance. TRL-1164’s typed client must consume the derived aggregate.

Readers of stored graph hashes, activation graphs, and overlay facts must move to the normalized read view, including Topography I/O/store/workspace/Wayfinder owners, operator compile/read/diff/doctor/regrade/release consumers, and Warden drift. The source census is an implementation aid rather than a fixed reader count; verify actual semantics on the implementation base.

## Consequences

Independent units reduce shared merge lines and localize corruption. They do not resolve edits to the same contract or replace the planned conflict resolver. Independent insertions at adjacent sorted positions can still conflict as text, including two new overlay namespaces. The issue reports 14 of 15 pair merges clean with that remaining adjacency conflict; this draft has not replayed the experiments. Send those real conflicts through `trails resolve`, without a custom merge driver or `merge=union`. Deriving aggregate views reduces redundant serialized truth but requires complete facts and a single shared owner for each derivation.

Implementation remains gated on the Topography hash-owner prerequisite, the lossless library derivation, the normalized read-view versus stored-shape contract, release checkpoint integration, and implementation of the force-state policy decided here. MCP skills, cache, and subscription namespace owners must confirm their exact units. Canonical draft creation and map generation remain coordinated with the documentation owner; no accepted number, status, or implementation claim is assigned here.

## References

- [ADR-0054](../0054-project-substrate-names-its-truth.md#one-app-owns-one-app-lock): current app-root lock ownership; [workspace view](../0054-project-substrate-names-its-truth.md#a-workspace-derives-one-app-partitioned-view) remains derived.
- [ADR-0052](../0052-overlays-one-extension-mechanism.md#the-category-question): one overlay mechanism and tolerant preservation of unknown facts.
- [ADR-0017](../0017-serialized-topo-graph.md): historical durable serialized graph contract.
- [ADR-0046](../0046-lock-v3-artifact-family.md): historical artifact layout, superseded by ADR-0054.
- [TRL-1424](https://linear.app/outfitter/issue/TRL-1424): proposal, reported merge experiments, and October 28 namespace decision. Those experiments are reported evidence, not independently replayed by this draft.
- [SET-767](https://linear.app/outfitter/issue/SET-767): completed separate Skillset implementation; compare its delivered vocabulary before acceptance. Local adoption is tracked by [TRL-1422](https://linear.app/outfitter/issue/TRL-1422).
- [TRL-771](https://linear.app/outfitter/issue/TRL-771): accepted-exception semantics requiring a retention decision.
- [TRL-1114](https://linear.app/outfitter/issue/TRL-1114): single hash owner prerequisite for implementation.
- [TRL-1164](https://linear.app/outfitter/issue/TRL-1164): typed client must consume the derived aggregate.
- [TRL-995](https://linear.app/outfitter/issue/TRL-995): draft disposition and decision-lineage reconciliation.
- [TRL-1423](https://linear.app/outfitter/issue/TRL-1423), [TRL-1419](https://linear.app/outfitter/issue/TRL-1419), and [TRL-1418](https://linear.app/outfitter/issue/TRL-1418): immediate recovery, targeting, and conflict-resolution sequence.
