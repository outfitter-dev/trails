---
slug: visibility-and-filtering
title: Trail Visibility and Surface Filtering
status: draft
created: 2026-03-31
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [packs-namespace-boundaries]
---

# ADR: Trail Visibility and Surface Filtering

## Context

### The problem at small scale

A simple Trails app has 5-10 trails. Every trail is a public verb. `blaze(app)` surfaces all of them on CLI, MCP, and HTTP. This is correct. Progressive disclosure isn't needed when there's nothing to disclose progressively.

### The problem at pack scale

A pack-scale app has 40-80 trails across multiple capability boundaries. Some trails exist only to support composition via `follow`. Others are debug or operator tools that shouldn't appear in a public API. Others make sense on CLI but not MCP. The current mechanism for managing this is `include`/`exclude` on blaze options, which works but has two problems:

1. **It's surface-side knowledge about trail-side intent.** The trail author knows "this trail is not a public verb, it exists to be followed." That information lives in the author's head, not in the trail definition. Every surface must independently be told to exclude it.

2. **It doesn't scale.** Flat string lists of trail IDs become unwieldy. Adding a new composition trail requires updating exclude lists on every surface. Forgetting one surface silently exposes an internal trail.

### What the trail author actually knows

The author knows one thing that the framework currently can't express: **whether a trail is a public verb or an internal composition target.** This is about the trail's role in the system, not about any particular surface. An internal trail isn't "hidden from CLI but shown on HTTP." It's "not a verb at all."

Everything else people want from "visibility" is either already derivable from information on the trail (intent, permit scopes, namespace hierarchy) or is a surface-level configuration concern (which surfaces show which trails). The trail shouldn't know about surfaces. That's the hexagonal model.

### The intent axis

Intent (`read`, `write`, `destroy`) is the most compounding property on a trail. It already drives HTTP verb derivation, MCP annotations, and will drive service access narrowing. But surfaces can't currently filter by intent. An MCP surface that should only expose read operations has to enumerate every read trail in an `include` list, or enumerate every write/destroy trail in an `exclude` list. Both are fragile.

Intent is authored on the trail. Filtering by intent at the surface is pure derivation.

### The permit axis

When an MCP connection resolves a permit with scopes `['entity:read', 'inbox:write']`, the surface knows what the connection can do. Every trail declares its required scopes (via the permits system). The surface could filter the tool list to only show trails the connection is authorized to call. But today it shows everything and returns `PermissionError` at call time.

For HTTP, showing everything and returning 403 is standard (the API shape is documented, access is enforced at runtime). For MCP, showing everything wastes agent context window on tools the agent can't use. Different surfaces want different discovery strategies for the same authorization data.

## Decision

### Part 1: `visibility` on the trail spec

One new optional field on the trail definition:

```typescript
const normalizePayload = trail('github.normalize-payload', {
  visibility: 'internal',
  intent: 'read',
  input: PayloadSchema,
  output: NormalizedSchema,
  run: async (input) => { /* ... */ },
});
```

`visibility` accepts two values:

- `'public'` (default, omitted in most definitions) -- the trail is a verb. Surfaces derive public commands, tools, and routes from it.
- `'internal'` -- the trail is a composition target. Surfaces skip it by default. `follow` and `dispatch` still work. Survey reports it with its visibility.

The default is `'public'` for backward compatibility. Existing trails don't change. Progressive adoption: add `visibility: 'internal'` to composition-only trails when it matters.

On the frozen Trail object, `visibility` is always present (defaulted to `'public'`). No runtime type narrowing needed. Same pattern as `follow` defaulting to `[]`.

### Part 2: Glob patterns in blaze include/exclude

`include` and `exclude` on blaze options accept glob patterns using the dotted namespace convention:

```typescript
// Exclude all dev trails
blaze(app, { exclude: ['dev.*'] });

// Include only github and inbox namespaces
blaze(app, { include: ['github.*', 'inbox.*'] });

// Mix of specific trails and patterns
blaze(app, { exclude: ['dev.*', 'debug.*', 'search.reindex'] });
```

Patterns match against trail IDs using standard glob semantics. `*` matches one segment. `**` matches any depth. This replaces flat string enumeration with namespace-aware filtering.

`internal` trails are excluded before glob filtering applies. An `include: ['github.*']` pattern does not promote `internal` trails to public. The `internal` declaration is a hard boundary. Explicit `include` of a specific internal trail by exact ID is the escape hatch:

```typescript
// This promotes a specific internal trail to public on this surface
blaze(app, { include: ['github.core.verify-webhook'] });
```

This is an override, visible and intentional. The default (internal trails are not surfaced) holds unless explicitly overridden by exact ID.

### Part 3: Intent filtering on blaze options

Blaze options accept an `intent` filter:

```typescript
// Read-only MCP surface for agents
blaze(app, { intent: ['read'] });

// Public API: read and write, no destroy
blaze(app, { intent: ['read', 'write'] });

// Operator CLI: everything (default, no filter)
blaze(app);
```

Intent filtering and glob patterns compose with AND logic:

```typescript
// Read-only GitHub trails for a scoped agent
blaze(app, {
  include: ['github.*'],
  intent: ['read'],
});
```

This surfaces trails that match the namespace pattern AND have the specified intent. Both filters must pass.

### Part 4: Permit-gated discovery on MCP

The MCP surface derives tool list filtering from the connection's resolved permit. This is a surface behavior, not a trail-level configuration.

When an MCP connection has a permit with scopes:

```text
permit scopes: ['github:read', 'inbox:read', 'inbox:write']
```

The MCP surface filters the tool list:

```text
github.pr.list    (intent: read)     → visible (github:read present)
github.pr.merge   (intent: write)    → hidden  (no github:write scope)
inbox.show        (intent: read)     → visible (inbox:read present)
inbox.triage      (intent: write)    → visible (inbox:write present)
inbox.archive     (intent: destroy)  → hidden  (no inbox:destroy scope)
```

The derivation is mechanical: match the trail's namespace + intent against the permit's scopes. No new field on the trail. The permit requirements and the trail's intent already carry the information. The MCP surface just uses it for discovery in addition to enforcement.

HTTP surfaces continue to document all routes in OpenAPI and enforce at call time (401/403). This is the standard behavior for documented APIs.

CLI surfaces in local development show everything by default (implicit local access). CLI surfaces with explicit permit configuration filter the same way as MCP.

Each surface makes its own discovery decision using the same underlying data. The trail doesn't know which surface it's on. The hexagonal model holds.

### Part 5: Environment-based trail activation via loadouts

Environment gating is a config concern, not a trail-level field. Loadouts (from the config ADR) can specify trail activation patterns:

```typescript
export default defineConfig({
  loadouts: {
    production: {
      exclude: ['dev.*'],
    },
    staging: {
      exclude: ['dev.reset-db', 'dev.seed'],
    },
    development: {
      // everything active
    },
  },
});
```

Loadout exclusions apply before surface-level blaze options. A trail excluded by the loadout is not in the topo for that environment. It can't be followed, dispatched, or surfaced.

The warden validates loadout integrity: a loadout that excludes a trail followed by an included trail is a dependency violation.

### Part 6: CLI help hierarchy from namespaces

The CLI surface derives help grouping from the dotted namespace convention in trail IDs:

```bash
$ trails --help
Commands:
  github     GitHub operations
  inbox      Inbox management
  search     Search operations

$ trails github --help
Commands:
  github pr       Pull request operations
  github issues   Issue operations

$ trails github pr --help
Commands:
  github pr list      List pull requests
  github pr show      Show pull request details
  github pr merge     Merge a pull request
```

No new trail-level field. The trail IDs already encode hierarchy. The CLI surface renders it. Pack membership (when packs ship) provides an additional grouping signal, with the pack name and description populating the top-level help group.

### How the filters compose

The filtering pipeline, in order:

1. **Loadout exclusions** remove trails from the topo for the current environment.
2. **Visibility** removes `internal` trails from surface consideration.
3. **Blaze `include`/`exclude` globs** narrow the surface to specific namespaces.
4. **Blaze `intent` filter** narrows to specific behavioral classes.
5. **Permit-gated discovery** (MCP, optionally CLI) narrows to authorized trails.

Each stage only removes. No stage adds back a trail removed by a previous stage (except the explicit exact-ID include escape hatch for internal trails in step 3). The pipeline is subtractive and predictable.

The **lockfile** captures the resolved visibility state after the full pipeline runs. Pack-level defaults, app-level overrides, and blaze options all collapse into a single deterministic snapshot per surface. This means the lockfile reflects the final effective visibility of every trail, not the raw authored values. Diffing the lockfile across environments or deploys shows exactly which trails gained or lost surface exposure.

### Warden rules

Four new governance rules follow from this ADR:

- **Dead internal trail.** An `internal` trail with no followers anywhere in the topo is unreachable. Warning.
- **Loadout dependency violation.** A loadout excludes trail B, but trail A (included in that loadout) follows B. Error.
- **Intent propagation.** A trail with `intent: 'read'` follows a trail with `intent: 'write'` or `'destroy'`. The composite operation has side effects, but the entry point claims to be read-only. Warning.
- **Missing visibility.** A trail that is only referenced in `follow` declarations and never surfaced directly could benefit from `visibility: 'internal'`. Coaching suggestion.

## Consequences

### Positive

- **One authored field for the one thing only the author knows.** `visibility: 'internal'` captures "this is not a public verb" directly on the trail. No surface-side bookkeeping.
- **Intent becomes a filtering axis.** One authored property, one more derivation. `blaze(app, { intent: ['read'] })` creates a read-only surface from the same topo. No per-trail annotation.
- **Permit-gated discovery compiles for free.** The MCP surface uses data it already has (permit scopes, trail intent) to filter the tool list. Agents see only what they can call. Zero ceremony.
- **Namespace-aware filtering.** Glob patterns replace flat string lists. `exclude: ['dev.*']` scales from 5 dev trails to 50 without maintenance.
- **Environment gating without trail pollution.** Loadouts handle activation per environment. The trail definition doesn't change across environments.
- **CLI discoverability from existing structure.** Help hierarchy derives from trail IDs that developers are already writing. No metadata or annotations needed.

### Tradeoffs

- **`visibility` is a new field on the trail spec.** This is a deliberate addition to the authored surface. It's justified because it captures genuinely new information (the trail's role) that the framework can't derive. But every addition to the trail spec is a cost.
- **The filtering pipeline has five stages.** Each stage is simple and subtractive, but the interaction between loadout exclusions, visibility, blaze globs, intent filters, and permit-gated discovery could surprise users in edge cases. Clear documentation of the pipeline order mitigates this.
- **Permit-gated discovery is surface-specific behavior.** HTTP and MCP handle discovery differently for the same trails. This is correct (different surfaces have different conventions) but means the answer to "will this trail appear?" depends on which surface you're asking about.

### What this does NOT decide

- Whether `visibility` will gain values beyond `'public'` and `'internal'`. Two values is enough. If a third is needed, a separate ADR will evaluate it.
- Whether surfaces can override intent-derived behavior. Currently, intent filtering in blaze is additive (you can only narrow, not widen). Whether a surface should be able to promote a `destroy` trail to appear in a read-only context is left open.
- How progressive disclosure (primary/secondary tool tiers) works on MCP. The MCP protocol supports deferred tool loading. Whether and how to leverage this is an MCP surface implementation concern, not an architectural decision. Pack membership and follow-graph analysis provide signals the surface can use.
- Whether visibility interacts with `dispatch()`. Currently, `dispatch()` can invoke any trail regardless of visibility. This is intentional: `dispatch` is programmatic, not surface-mediated.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) -- "derive by default, override deliberately"; the information architecture categories
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) -- the trail spec that gains the `visibility` field
- [ADR-0004: Intent as a First-Class Property](../0004-intent-as-first-class-property.md) -- intent drives HTTP verbs, MCP annotations, and now surface filtering
- [ADR-0008: Deterministic Surface Derivation](../0008-deterministic-surface-derivation.md) -- the derivation rules that visibility and intent filtering extend
- [ADR-0013: Crumbs](../0013-crumbs.md) -- the telemetry system; visibility filtering events are observable through crumbs
- ADR: The Serialized Topo Graph (draft) -- the lockfile captures resolved visibility state after all overrides are applied
- ADR: Packs as Namespace Boundaries (draft) -- packs set default visibility for their trails; depends on this ADR
