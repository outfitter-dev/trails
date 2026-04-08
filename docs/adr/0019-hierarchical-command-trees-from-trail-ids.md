---
id: 19
slug: hierarchical-command-trees-from-trail-ids
title: Hierarchical Command Trees from Trail IDs
status: accepted
created: 2026-04-03
updated: 2026-04-03
owners: ['[galligan](https://github.com/galligan)']
depends_on: [8]
---

# ADR-0019: Hierarchical Command Trees from Trail IDs

## Context

Trails already treats a trail ID as a durable authored artifact. The same ID feeds CLI names, MCP tool names, HTTP paths, diff artifacts, and documentation. That is exactly the kind of one-write-many-reads multiplication the framework is supposed to provide.

But the current CLI derivation only reads part of that authored story. `buildCliCommands()` splits on the first dot and produces `group + name`, so `topo.pin` becomes group `topo`, name `pin`, and `topo.pin.remove` collapses into group `topo`, name `pin.remove`.[^build-cli] The Commander adapter mirrors that limitation by creating only one parent layer.[^to-commander]

That forces the trail contract to bend around a shallow CLI model:

- trail IDs have to grow fake leaf names like `topo.show` just to keep `topo` free as a group
- deeper command trees cannot be expressed cleanly
- the CLI stops feeling like a rendering of the trail contract and starts feeling like a separate authoring system

The tension shows up immediately in the accepted topo work. `topo`, `topo.pin`, `topo.verify`, and `tracing.query` are natural trail IDs. The current CLI can only render them awkwardly.

## Decision

Trail IDs derive to **ordered command segments**, not `group + leaf`.

```text
topo                -> ["topo"]
topo.pin            -> ["topo", "pin"]
topo.pin.remove     -> ["topo", "pin", "remove"]
tracing.query       -> ["tracing", "query"]
```

### The full dot path is the projection

The canonical CLI projection of a trail ID is its full ordered segment path.

This means:

- every dot in the trail ID is structurally meaningful to the CLI
- the trailhead map and lockfile record the full path, not a special CLI-only `group` abstraction
- the CLI is free to render an arbitrary-depth command tree from that path

The first-dot rule goes away. A trail ID is not "a group plus a command." It is a path.

### Executable parents are valid

A command path node may be both:

- an executable trail
- a parent of more specific child trails

That means `topo` and `topo pin` can coexist naturally.

```text
trails topo
trails topo pin --name before-auth
trails topo verify
```

This is not a special case. It falls out of the path model directly.

### Core owns the path projection; trailheads render it

The segment path is trailhead-agnostic resolved state. The framework should expose it as a deterministic derivation that other packages can consume.

This means:

- core or schema owns the canonical path projection from trail ID to ordered segments
- `@ontrails/cli` consumes that projection to build a nested command tree
- other trailheads may also use the same segment projection where it fits

HTTP already trends this way:

```text
topo.pin -> /api/topo/pin
```

MCP remains flat because MCP tool names are flat strings by protocol. The command-tree ADR does not change that.

### Trailhead maps record the path explicitly

The serialized CLI projection must record the full path:

```json
{
  "cli": {
    "path": ["topo", "pin"]
  }
}
```

This keeps the queryable contract honest. Agents, CI, and diff tooling can see the same path the CLI uses.

### Overrides stay available

The default remains: derive the path from the trail ID.

The escape hatch remains: a trail may deliberately override its CLI projection when the derived path is wrong for a specific case.

Overrides must stay:

- explicit
- local to the affected trail
- visible in the resolved graph

No separate CLI authoring language is introduced. The override is still a projection override on top of the trail contract, not a second source of truth.

## Consequences

### Positive

- **The CLI stops distorting trail IDs.** Trails can use natural IDs like `topo`, `topo.pin`, and `tracing.query` without fake `.show` leaves.
- **Nested subcommands become a normal rendering, not a workaround.** The CLI can represent the same hierarchy the trail IDs already express.
- **Executable parents fit the model directly.** `trails topo` and `trails topo pin` no longer compete for the same namespace slot.
- **The projection compounds across surfaces.** HTTP and CLI both benefit from the same segment story, even though they render it differently.
- **The queryable contract stays complete.** Trailhead maps and the lockfile can record the actual path instead of a shallow adapter-specific shape.

### Tradeoffs

- **The CLI adapter becomes more complex.** A real command tree with executable parents is more work than a one-level group map.
- **Path collisions need deeper validation.** `topo` and `topo.pin` are valid together, but incompatible shapes like a positional-only parent plus conflicting child paths need explicit handling.
- **Existing CLI expectations shift.** Commands derived from multi-dot IDs will change shape once the full-path rule is adopted.

### What this does NOT decide

- The exact option shape for structured CLI input. That is decided by the companion CLI input ADR.
- The exact override API for CLI projection. This ADR preserves the escape hatch but does not fix the final shape of the config surface.
- Commander-specific UX details such as custom help rendering or breadcrumb formatting.

## References

- [ADR-0008: Deterministic Trailhead Derivation](0008-deterministic-trailhead-derivation.md) — this extends the CLI derivation story from a shallow first-dot grouping rule to a full ordered path
- [ADR-0001: Naming Conventions](0001-naming-conventions.md) — trail IDs are authored artifacts that feed multiple projections
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md) — CLI projections belong in the resolved graph and lockfile
- [Trails Design Tenets](../tenets.md) — especially "one write, many reads" and "the trail is the product"

[^build-cli]: [`packages/cli/src/build.ts`](../../packages/cli/src/build.ts) previously parsed a trail ID into `{ group, name }` by splitting on the first dot. It will call `deriveCliPath` which splits on all dots to produce a full command path.
[^to-commander]: [`packages/cli/src/commander/to-commander.ts`](../../packages/cli/src/commander/to-commander.ts) previously created only one parent layer keyed by `group`. It will build a full nested command tree via `ensureCommandNode`.
