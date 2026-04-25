---
id: 17
slug: serialized-topo-graph
title: The Serialized Topo Graph
status: accepted
created: 2026-03-31
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [7, 8]
---

# ADR-0017: The Serialized Topo Graph

## Context

Earlier implementations produced `trailhead.lock` via `trails survey generate`. That file captured the derived surface shape (MCP tool names, CLI commands, HTTP routes) as a diffable, hashable artifact. CI compared it against the current topo to detect unintentional contract changes.

As the framework grows, more resolved state needs the same treatment: surfaces, signals, fires, resources, config, the reactive graph. Each is "resolved state of the system that should be diffable and governable." Splitting them into separate lockfiles creates multiple files to commit, multiple CI checks to configure, and multiple commands to remember.

But the deeper issue is that these aren't independent concerns. A trail's surface derivation, its fire activations, its signal emissions, its resource dependencies, and its `crosses` declarations are all facets of the same graph. Surfaces reference trails. Fires reference signals. Signals reference emitters. Resources reference config. The resolved state of the system is a single connected graph, not a collection of independent sections.

### The lockfile as the story

An agent connecting to an unfamiliar Trails workspace should be able to read one file and understand the entire system: what trails exist, what activates them, what they signal, what resources they need, how they compose, what surfaces expose them, and what permissions they require. That file is the lockfile.

This aligns with the design tenet: *the contract is queryable*. The lockfile is the fully resolved, serialized form of the queryable contract. It's the topo graph with all derivations applied, all references resolved, all edges explicit.

### Multi-app workspaces

A Trails workspace can contain multiple apps, each with its own topo. The lockfile must catalog every trail across every app. Most trail IDs are unique workspace-wide — `booking.confirm` only exists in one app. The lockfile enables direct resolution: given a trail ID, find the app.

When a trail ID exists in multiple apps (e.g., `health.check` in both `trails-api` and `trails-admin`), the lockfile records both. Consumers that need to resolve ambiguity (like `trails run`) can prompt the developer or accept an `--app` override.

### Migration from `trailhead.lock`

The old `trailhead.lock` had no external consumers. It was generated, committed, and checked by the framework's own tooling. The migration was mechanical: the existing surface lock content became part of the trail nodes in the new graph. The warden rule that validates the lock updates to read from the new location.

## Decision

### One lockfile: `.trails/trails.lock`

All resolved framework state lives in `.trails/trails.lock`. The file is structured as a serialized topo graph. Every trail, resource, signal, and surface is a node. Relationships — fires, crosses, signals, consumes — are edges. The file is the compiled, resolved, deduplicated story of the workspace.

```json
{
  "version": 1,
  "apps": {
    "trails-api": {
      "entry": "packages/api/src/app.ts",
      "trails": {
        "booking.confirm": {
          "intent": "write",
          "input": { /* resolved JSON Schema */ },
          "output": { /* resolved JSON Schema */ },
          "permit": { "scopes": ["booking:write"] },
          "signals": ["booking.confirmed"],
          "crosses": ["availability.reserve", "billing.charge"],
          "fires": [{ "type": "webhook:stripe", "event": "payment_intent.succeeded" }],
          "resources": ["bookingStore", "billingService"],
          "visibility": "public",
          "examples": 3,
          "surfaces": {
            "cli": { "command": "booking confirm", "flags": ["slotId", "userId"] },
            "mcp": { "name": "trails-api_booking_confirm" },
            "http": { "method": "POST", "path": "/booking/confirm" }
          }
        }
      },
      "signals": {
        "booking.confirmed": {
          "schema": { /* resolved JSON Schema */ },
          "emittedBy": ["booking.confirm"],
          "consumedBy": ["notify.booking-confirmed", "audit.log-write"]
        }
      },
      "resources": {
        "bookingStore": {
          "config": { /* resolved config schema */ },
          "consumedBy": ["booking.confirm", "booking.cancel", "booking.show"]
        }
      }
    }
  }
}
```

A single trail entry carries everything: input/output schemas, intent, permit requirements, signal emissions, `crosses` declarations, fire activations, resource dependencies, visibility, example count, and per-surface derivations. No duplication — the trail is the node, everything else is an edge or a property.

### The graph, not sections

The lockfile is not organized by concern (a surfaces section, a signals section, a triggers section). It's organized by the topo graph: apps contain trails, signals, and resources. Relationships between them are edges on the nodes.

This means:

- Adding a new framework feature (e.g., signals) doesn't require a new top-level section. Signals are properties on trail nodes (fires) and standalone nodes (signal declarations) within the app.
- Cross-cutting queries are natural: "which trails fire signals with no consumers?" is a graph traversal, not a cross-section join.
- The lockfile grows organically as the topo's type system grows, without structural changes to the file format.

### Generation and lifecycle

```bash
trails topo export           # write .trails/trails.lock from current topo
trails topo verify           # verify .trails/trails.lock matches current topo (CI mode)
trails topo diff --lock      # show lockfile drift against current topo
```

`trails topo export` replaces the old lock-focused command shape. The command now centers on the thing being exported rather than on the artifact. `verify` is the CI layer. `diff --lock` is the developer feedback loop.

The lockfile is:

- **Generated** by `trails topo export` from the current code. In manual workflows this is explicit, like `bun install` generating `bun.lock`. Signal-driven flows can invoke the same trail automatically from topo snapshots or pins.
- **Checked in** to source control. A PR that changes trail contracts produces a lockfile diff.
- **CI-diffable.** `trails topo verify` fails if the lockfile doesn't match the current code. Drift between code and lockfile is caught before merge.
- **The saved record of resolved state.** Not a cache, not a convenience. A commitment: "this is the resolved state of the system at this point in time."

Development commands (`trails run`, `trails guide`) should degrade gracefully without a lockfile in single-app projects by falling back to direct topo loading. In multi-app workspaces, the lockfile is required for cross-app trail ID resolution.

### Trail ID resolution

The lockfile enables workspace-wide trail ID resolution:

```bash
# The lockfile knows booking.confirm lives in trails-api
trails run booking.confirm '{"slotId": "slot_1"}'
```

Most trail IDs are unique across the workspace. When they collide:

```bash
$ trails run health.check
? health.check exists in multiple apps:
  › trails-api (packages/api)
  › trails-admin (packages/admin)
```

The `--app` flag is an override for the collision case, not a required parameter.

### Reactive graph resolution

The lockfile captures the full reactive graph: which signals trigger which trails, which trails fire which signals, the complete activation chain. This makes the reactive graph inspectable without running the app:

```bash
# Derived from the lockfile
trails topo show --reactive
webhook:stripe → booking.confirm → booking.confirmed → notify.booking-confirmed
                                                      → audit.log-write
```

## Consequences

### Positive

- **One file to commit.** A PR that changes trail schemas, adds triggers, updates resources, and modifies config produces one lockfile diff.
- **One CI check.** `trails topo verify` validates everything.
- **Agent-readable.** An agent reads the lockfile to understand the entire system without source code. The contract is queryable.
- **Graph-native.** Cross-cutting queries (orphan signals, unreachable trails, trigger cycles) are natural graph traversals.
- **Multi-app resolution.** Trail IDs resolve workspace-wide. `trails run` and `trails guide` work across apps without specifying which app owns a trail.
- **Co-located.** `.trails/trails.lock` sits alongside the rest of the framework workspace.

### Tradeoffs

- **Larger file over time.** As the topo grows, the lockfile grows. For most projects this is manageable. For very large workspaces, the graph structure helps: changes to one trail only affect that trail's node and its edges.
- **Requires topo export to stay current.** A stale lockfile means stale resolution. `trails topo verify` in CI catches this, but a manual workflow must still export after contract changes unless a save- or pin-driven automation does it.
- **Graph format is more complex than flat sections.** A section-per-concern format is simpler to understand at first glance. The graph format is more powerful but requires understanding the node/edge model. The tradeoff favors power: the lockfile is primarily machine-read (by agents, CI, framework commands), not human-read.

### What this does NOT decide

- **The exact schema for each node type.** Trail nodes, signal nodes, and resource nodes will gain properties as their respective ADRs ship. The graph structure is stable; the node schemas evolve.
- **Whether sections can be independently regenerated** (e.g., `trails topo export --only surfaces`). Future ergonomic improvement if needed.
- **Whether the format is JSON, JSONC, or another structured format.** JSON is the default for machine-generated artifacts. If comments become valuable, JSONC is a backward-compatible extension.
- **Resource contract snapshots.** How provisioned packs record their contract state in the lockfile. The resources ADR defines this.
- **Rig lock state.** How rigged external surfaces record their resolved state. The rig ADR defines this.

## References

- [ADR-0008: Deterministic Surface Derivation](0008-deterministic-trailhead-derivation.md) — the derivation rules that produce surface properties on trail nodes
- [ADR-0007: Governance as Trails](0007-governance-as-trails.md) — the warden rules that validate the lock
- ADR: Typed Signal Emission (draft) — signals as nodes in the graph, fire edges on trail nodes
- ADR: Reactive Trail Activation (draft) — trigger activations as edges, reactive graph resolution
- ADR: Packs as Namespace Boundaries (draft) — pack boundaries as subgraphs within the topo
- ADR: Pack Provisioning (draft) — provisioned pack state recorded in the graph
- ADR: Trail Run (draft) — trail ID resolution via the lockfile

### Amendment log

- 2026-04-16: In-place vocabulary update per ADR-0035 Cutover 3 — `topo saves` → `topo snapshots`.
- 2026-04-16: In-place vocabulary update per ADR-0035 Cutover 3 — surface vocabulary aligned in prose; migration section title retained as `trailhead.lock` (historical context).
