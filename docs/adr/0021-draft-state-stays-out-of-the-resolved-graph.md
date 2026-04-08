---
id: 21
slug: draft-state-stays-out-of-the-resolved-graph
title: Draft State Stays Out of the Resolved Graph
status: accepted
created: 2026-04-03
updated: 2026-04-03
owners: ['[galligan](https://github.com/galligan)']
depends_on: [17]
---

# ADR-0021: Draft State Stays Out of the Resolved Graph

## Context

Trails wants top-down authoring. Sketch the system, tighten the contracts, then fill in the implementation. That is how the framework reads best, and it is how agents naturally work.

But the current validation path makes that hard in exactly the places where the graph matters most. The Stash retro hit one clear example: an event wanted to declare `from: ['gist.fork']` before `gist.fork` existed, and topo validation rejected the entire shape.[^retro]

The obvious escape hatch in most frameworks is "just use a placeholder and clean it up later." Trails can do better than that, but it also cannot weaken the resolved graph to make authoring easier. The resolved graph is the story. Lockfiles, trailhead maps, CI, and runtime trailheads all depend on it being fully established and queryable.[^tenets]

This is one of the few places where Trails has unusually strong structural leverage. We already have:

- typed declarations
- a topo
- warden validation
- trailhead derivation
- lockfile export

That means a lazy authoring path does not have to be a loose convention. It can be a controlled draft state with hard containment.

## Decision

Trails distinguishes between **draft** authored state and **established** resolved state.

### `_draft.` is the reserved draft marker for IDs

Any authored ID may be marked as draft by prefixing it with `_draft.`:

```text
_draft.gist.fork
_draft.gist.created
_draft.gist.store
```

This marker applies to declarations and references.

Examples:

- a draft trail ID
- a draft signal ID
- a draft resource ID
- a `crosses` entry that points at a draft trail
- a signal `from` entry that points at a draft trail

The marker is not "just part of the string." Tooling must recognize it as draft state immediately.

### Draft-bearing files must be visibly marked

Files that contain draft-only authored state must be visibly marked on disk.

The rule is:

- files whose primary purpose is draft state use the `_draft.` prefix
- otherwise-normal files that contain draft state use a `.draft.` trailing segment before the extension

Examples:

- `_draft.topo.ts`
- `signals.draft.ts`
- `gist.trails.draft.ts`

This keeps draft state grepable and visible without reserving `_` for every filename convention in the repo.

### Draft contaminates downstream dependencies

Draft state is allowed in the authored graph. It is not allowed in the established resolved graph.

The contamination rules are:

- established nodes may depend only on established nodes
- draft nodes may depend on established nodes or other draft nodes
- if an established node depends on a draft node, it becomes draft-contaminated

From the point of insertion, upstream remains established. Downstream inherits the draft requirement.

```text
gist.show              -> established
_draft.gist.fork       -> draft
gist.export crosses _draft.gist.fork -> gist.export becomes draft-contaminated
```

### The authored graph may contain drafts; the resolved graph may not

Draft state is valid in authoring and governance workflows. It is not valid in established outputs.

This means:

- warden and draft-aware topo inspection may read draft-bearing files and draft references
- the standard resolved topo excludes draft declarations and rejects draft contamination
- trailhead builders reject draft state
- lockfile export rejects draft state
- established build outputs never include draft nodes or edges

The framework therefore exposes two views of the system:

- the **authored graph**, which may contain draft state
- the **established graph**, which may not

### Promotion is a first-class workflow

Draft state is not a dead end. Tooling must provide a promotion workflow that:

- rewrites a `_draft.` ID to an established ID
- updates inbound references
- verifies that the promoted node no longer depends on unresolved draft state

The exact command shape is deferred. The workflow is not.

### Warden treats draft state as visible debt

Draft presence is never silent.

This means:

- draft state produces warden findings by default
- established exports fail if draft contamination remains
- tooling should help the developer see why a node is still draft-contaminated and what must be promoted first

Draft state is a deliberate sketching tool, not an invisible shortcut.

## Consequences

### Positive

- **Top-down sketching becomes safe.** A developer can model future trails, signals, and resources before every dependency exists.
- **The resolved graph stays trustworthy.** Established outputs remain fully queryable and free of placeholder state.
- **Draft state is obvious in code review.** Both IDs and filenames make draft-bearing authoring visible.
- **Promotion has a clean path.** Drafts do not rely on ad hoc search-and-replace once the real shape exists.

### Tradeoffs

- **There are now two graph views.** That is extra conceptual weight, even though the boundary is explicit.
- **Contamination can spread further than the author expects.** One draft edge can turn a surprising amount of downstream work into draft state until it is promoted.
- **Tooling has to explain contamination well.** The model is only humane if the framework can show why something is still draft.

### What this does NOT decide

- The exact CLI command names for draft inspection or promotion
- Whether draft state can be executed in an explicitly draft-only local mode
- Whether non-ID authored values get a parallel draft marker later

## References

- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md) — the resolved graph and lockfile must remain established and queryable
- [ADR-0001: Naming Conventions](0001-naming-conventions.md) — trail IDs are meaningful authored artifacts, so the draft marker must be deliberate and visible
- [Trails Design Tenets](../tenets.md) — especially "the resolved graph is the story" and "the contract is queryable"

[^retro]: The Stash dogfood retro identified eager validation of event `from` references as a barrier to incremental authoring.
[^tenets]: [Trails Design Tenets](../tenets.md) states that the resolved graph is the story and that the contract must stay queryable.
