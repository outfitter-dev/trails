---
slug: serialized-topo-graph
title: The Serialized Topo Graph
status: draft
created: 2026-03-31
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [7, 8]
---

# ADR: The Serialized Topo Graph

## Context

The framework currently produces `surface.lock` via `trails schema lock`. This file captures the derived surface shape (MCP tool names, CLI commands, HTTP routes) as a diffable, hashable artifact. CI compares it against the current topo to detect unintentional contract changes.

As the framework grows, more resolved state needs the same treatment: surfaces, events, triggers, services, provisions, config, the reactive graph. Each is "resolved state of the system that should be diffable and governable." Splitting them into separate lockfiles creates multiple files to commit, multiple CI checks to configure, and multiple commands to remember.

But the deeper issue is that these aren't independent concerns. A trail's surface derivation, its trigger activations, its event emissions, its service dependencies, and its follow declarations are all facets of the same graph. Surfaces reference trails. Triggers reference events. Events reference emitters. Services reference config. The resolved state of the system is a single connected graph, not a collection of independent sections.

### The lockfile as the story

An agent connecting to an unfamiliar Trails workspace should be able to read one file and understand the entire system: what trails exist, what activates them, what they emit, what services they need, how they compose, what surfaces expose them, and what permissions they require. That file is the lockfile.

This aligns with the design tenet: *the contract is queryable*. The lockfile is the fully resolved, serialized form of the queryable contract. It's the topo graph with all derivations applied, all references resolved, all edges explicit.

### Multi-app workspaces

A Trails workspace can contain multiple apps, each with its own topo. The lockfile must catalog every trail across every app. Most trail IDs are unique workspace-wide — `booking.confirm` only exists in one app. The lockfile enables direct resolution: given a trail ID, find the app.

When a trail ID exists in multiple apps (e.g., `health.check` in both `trails-api` and `trails-admin`), the lockfile records both. Consumers that need to resolve ambiguity (like `trails run`) can prompt the developer or accept an `--app` override.

### Migration from `surface.lock`

The current `surface.lock` has no external consumers. It's generated, committed, and checked by the framework's own tooling. The migration is mechanical: the existing surface lock content becomes part of the trail nodes in the new graph. The warden rule that validates the lock updates to read from the new location.

## Decision

### One lockfile: `.trails/trails.lock`

All resolved framework state lives in `.trails/trails.lock`. The file is structured as a serialized topo graph. Every trail, service, event, and surface is a node. Relationships — triggers, follows, emits, consumes — are edges. The file is the compiled, resolved, deduplicated story of the workspace.

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
          "emits": ["booking.confirmed"],
          "follow": ["availability.reserve", "billing.charge"],
          "on": [{ "type": "webhook:stripe", "event": "payment_intent.succeeded" }],
          "services": ["bookingStore", "billingService"],
          "visibility": "public",
          "examples": 3,
          "surfaces": {
            "cli": { "command": "booking confirm", "flags": ["slotId", "userId"] },
            "mcp": { "name": "trails-api_booking_confirm" },
            "http": { "method": "POST", "path": "/booking/confirm" }
          }
        }
      },
      "events": {
        "booking.confirmed": {
          "schema": { /* resolved JSON Schema */ },
          "emittedBy": ["booking.confirm"],
          "consumedBy": ["notify.booking-confirmed", "audit.log-write"]
        }
      },
      "services": {
        "bookingStore": {
          "config": { /* resolved config schema */ },
          "consumedBy": ["booking.confirm", "booking.cancel", "booking.show"]
        }
      }
    }
  }
}
```

A single trail entry carries everything: input/output schemas, intent, permit requirements, event emissions, follow declarations, trigger activations, service dependencies, visibility, example count, and per-surface derivations. No duplication — the trail is the node, everything else is an edge or a property.

### The graph, not sections

The lockfile is not organized by concern (a surfaces section, an events section, a triggers section). It's organized by the topo graph: apps contain trails, events, and services. Relationships between them are edges on the nodes.

This means:

- Adding a new framework feature (e.g., events) doesn't require a new top-level section. Events are properties on trail nodes (emits) and standalone nodes (event declarations) within the app.
- Cross-cutting queries are natural: "which trails emit events with no consumers?" is a graph traversal, not a cross-section join.
- The lockfile grows organically as the topo's type system grows, without structural changes to the file format.

### Generation and lifecycle

```bash
trails lock                  # regenerate trails.lock from current topo
trails lock --check          # verify trails.lock matches current topo (CI mode)
trails lock --diff           # show what changed since last lock
```

`trails lock` replaces `trails schema lock`. The command is shorter, the scope is broader. `--check` is the CI gate. `--diff` is the developer feedback loop.

The lockfile is:

- **Generated** by `trails lock` from the current code. Explicit action, like `bun install` generating `bun.lock`.
- **Checked in** to source control. A PR that changes trail contracts produces a lockfile diff.
- **CI-diffable.** `trails lock --check` fails if the lockfile doesn't match the current code. Drift between code and lockfile is caught before merge.
- **The checkpoint of resolved state.** Not a cache, not a convenience. A commitment: "this is the resolved state of the system at this point in time."

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

The lockfile captures the full reactive graph: which events trigger which trails, which trails emit which events, the complete activation chain. This makes the reactive graph inspectable without running the app:

```bash
# Derived from the lockfile
trails survey --reactive
webhook:stripe → booking.confirm → booking.confirmed → notify.booking-confirmed
                                                      → audit.log-write
```

## Consequences

### Positive

- **One file to commit.** A PR that changes trail schemas, adds triggers, updates provisions, and modifies config produces one lockfile diff.
- **One CI check.** `trails lock --check` validates everything.
- **Agent-readable.** An agent reads the lockfile to understand the entire system without source code. The contract is queryable.
- **Graph-native.** Cross-cutting queries (orphan events, unreachable trails, trigger cycles) are natural graph traversals.
- **Multi-app resolution.** Trail IDs resolve workspace-wide. `trails run` and `trails guide` work across apps without specifying which app owns a trail.
- **Co-located.** `.trails/trails.lock` sits alongside the rest of the framework workspace.

### Tradeoffs

- **Larger file over time.** As the topo grows, the lockfile grows. For most projects this is manageable. For very large workspaces, the graph structure helps: changes to one trail only affect that trail's node and its edges.
- **Requires `trails lock` to stay current.** A stale lockfile means stale resolution. `trails lock --check` in CI catches this, but the developer must remember to regenerate. This is the same discipline as `bun install` after editing `package.json`.
- **Graph format is more complex than flat sections.** A section-per-concern format is simpler to understand at first glance. The graph format is more powerful but requires understanding the node/edge model. The tradeoff favors power: the lockfile is primarily machine-read (by agents, CI, framework commands), not human-read.

### What this does NOT decide

- **The exact schema for each node type.** Trail nodes, event nodes, and service nodes will gain properties as their respective ADRs ship. The graph structure is stable; the node schemas evolve.
- **Whether sections can be independently regenerated** (e.g., `trails lock --only surfaces`). Future ergonomic improvement if needed.
- **Whether the format is JSON, JSONC, or another structured format.** JSON is the default for machine-generated artifacts. If comments become valuable, JSONC is a backward-compatible extension.
- **Provision contract snapshots.** How provisioned packs record their contract state in the lockfile. The provisions ADR defines this.
- **Rig lock state.** How rigged external surfaces record their resolved state. The rig ADR defines this.

## References

- [ADR-0008: Deterministic Surface Derivation](../0008-deterministic-surface-derivation.md) — the derivation rules that produce surface properties on trail nodes
- [ADR-0007: Governance as Trails](../0007-governance-as-trails.md) — the warden rules that validate the lock
- ADR: Typed Event Emission (draft) — events as nodes in the graph, emission edges on trail nodes
- ADR: Reactive Trail Activation (draft) — trigger activations as edges, reactive graph resolution
- ADR: Packs as Namespace Boundaries (draft) — pack boundaries as subgraphs within the topo
- ADR: Pack Provisioning (draft) — provisioned pack state recorded in the graph
- ADR: Trail Run (draft) — trail ID resolution via the lockfile
