# Beta 14

Released 2026-04-04. 14 PRs (#64–#77), 453 files changed, 34,899 insertions.

## Highlights

### Topo store

The resolved topology is now queryable via SQLite. `.trails/trails.db` stores every topo snapshot with trails, signals, resources, crossings, and their relationships. Pin important versions, diff between states, verify lockfiles in CI, and run governance queries directly against the relational store.

New commands: `topo pin`, `topo unpin`, `topo show`, `topo history`, `topo export`, `topo verify`.

**ADRs:** [0014](../adr/0014-core-database-primitive.md), [0015](../adr/0015-topo-store.md)  
**Guide:** [Topo Store](../topo-store.md), [Reference](../topo-store-reference.md)

### Store package

`@ontrails/store` provides schema-derived persistence. Declare tables with Zod schemas, primary keys, generated fields, indexes, references, and fixtures. Bind to a runtime with `@ontrails/store/drizzle` for typed CRUD accessors, fixtures-as-mocks, and read-only bindings.

**ADRs:** [0016](../adr/0016-schema-derived-persistence.md), [0022](../adr/0022-drizzle-store-connector.md)  
**Guide:** [Store README](../../packages/store/README.md)

### Hierarchical CLI commands

Trail IDs now derive nested command trees. `entity.create` becomes `trails entity create`. No manual command registration — the structure comes from the trail ID.

**ADR:** [0019](../adr/0019-hierarchical-command-trees-from-trail-ids.md)

### Structured CLI input

Three new channels for passing complex input to CLI trails:

- `--input-json '<json>'` — inline JSON
- `--input-file <path>` — read from file
- `--stdin` — pipe from stdin

Channels merge with individual flags in a deterministic priority order.

**ADR:** [0020](../adr/0020-flags-for-fields-structured-input-on-the-cli.md)

### Draft state containment

The `_draft.` ID prefix marks trails, signals, and resources as draft. Draft state lives in the authored graph but is excluded from established outputs — trailheads, lockfiles, topo exports. `trails draft promote` converts draft IDs to established with full reference rewriting.

**ADR:** [0021](../adr/0021-draft-state-stays-out-of-the-resolved-graph.md)  
**Guide:** [Draft State](../draft-state.md)

### Serialized topo graph

The lockfile is now the serialized, resolved topology — a deterministic snapshot of every trail, signal, resource, and their relationships. CI can diff lockfiles to detect topology drift.

**ADR:** [0017](../adr/0017-serialized-topo-graph.md)

### Signal-driven governance

Governance rules can now emit signals when they detect issues, enabling reactive workflows — a warden finding can trigger a notification trail, update a dashboard, or block a deploy.

**ADR:** [0018](../adr/0018-signal-driven-governance.md)

### Dev commands

New developer tooling trails: `dev stats` (codebase statistics), `dev clean` (clean generated files), `dev reset` (reset workspace).

## Vocabulary cutover

Beta 14 completes the vocabulary alignment started in beta 13. All framework-specific terms now use trail-native language consistently.

| Before | After |
| --- | --- |
| `services:` | `resources:` |
| `follow:` / `ctx.follow()` | `crosses:` / `ctx.cross()` |
| `emits:` / `ctx.emit()` | `signals:` / `ctx.signal()` |
| `metadata:` | `meta:` |
| `ctx.signal` (abort) | `ctx.abortSignal` |
| `surface` | `trailhead` |
| `blaze(app)` | `trailhead(app)` |
| `Layer` | `Layer` |
| `dispatch()` | `run()` |
| `adapter` | `connector` |
| `@ontrails/crumbs` | `@ontrails/tracing` |

## New ADRs

| ADR | Title |
| --- | --- |
| [0014](../adr/0014-core-database-primitive.md) | Core Database Primitive |
| [0015](../adr/0015-topo-store.md) | Topo Store |
| [0016](../adr/0016-schema-derived-persistence.md) | Schema-Derived Persistence |
| [0017](../adr/0017-serialized-topo-graph.md) | Serialized Topo Graph |
| [0018](../adr/0018-signal-driven-governance.md) | Signal-Driven Governance |
| [0019](../adr/0019-hierarchical-command-trees-from-trail-ids.md) | Hierarchical Command Trees |
| [0020](../adr/0020-flags-for-fields-structured-input-on-the-cli.md) | Structured CLI Input |
| [0021](../adr/0021-draft-state-stays-out-of-the-resolved-graph.md) | Draft State Containment |
| [0022](../adr/0022-drizzle-store-connector.md) | Drizzle Store Connector |

## Packages

All `@ontrails/*` packages ship at `1.0.0-beta.14`.

| Package | What changed |
| --- | --- |
| `@ontrails/core` | Topo store, draft state, resources vocabulary |
| `@ontrails/cli` | Hierarchical commands, structured input |
| `@ontrails/store` | **New** — schema-derived persistence |
| `@ontrails/store/drizzle` | **New** — Drizzle connector (subpath export of `@ontrails/store`) |
| `@ontrails/schema` | Topo export, schema cache |
| `@ontrails/warden` | Resource rules, draft state rules |
| `@ontrails/config` | Resource and layer vocabulary |
| `@ontrails/permits` | Resource and layer vocabulary |
| `@ontrails/tracing` | Resource and layer vocabulary |
| `@ontrails/testing` | Resource-aware test utilities |
| `@ontrails/http` | Trailhead vocabulary |
| `@ontrails/mcp` | Trailhead vocabulary |
| `@ontrails/logging` | No changes |
