---
slug: cli-command-routes
title: CLI Command Routes Normalize Into Trail Contracts
status: draft
created: 2026-06-13
updated: 2026-06-13
owners: ['[galligan](https://github.com/galligan)']
depends_on: ['8', '19', '35', '47']
linear:
  - TRL-957
  - TRL-958
  - TRL-959
  - TRL-960
  - TRL-961
  - TRL-962
---

# ADR: CLI Command Routes Normalize Into Trail Contracts

## Context

Dogfooding Trails against downstream CLI work exposed a real ergonomics gap. The CLI is derived from the trail graph, but real command-line tools need compatibility aliases, shorter command forms, and sometimes more than one command path that reaches the same capability.

The naive answer is to add a large typed CLI projection field and make authors describe the whole command model directly. That is the wrong burden. Trails should not make developers hand-author machinery the framework can derive.

The other naive answer is to treat every alternate command path as a new trail. That is also too blunt. Some alternate command paths are simply alternate CLI surface bindings for the same contract. If they validate into the same input schema, return the same output schema, use the same permit model, and run the same trail, they do not need a second trail just to satisfy CLI ergonomics.

[ADR-0019](../0019-hierarchical-command-trees-from-trail-ids.md) already reserves this space. Trail IDs derive canonical CLI command paths by default, but a trail may override its CLI projection when derivation is wrong. Overrides must stay explicit, local, visible in the resolved graph, and must not introduce a second CLI authoring language.

This ADR fills that gap.

## Decision

### CLI command routes are projection metadata

This ADR uses **CLI command route** to mean one concrete command path that a CLI surface accepts for a trail. It is a CLI projection term, not an HTTP route.

In the cross-surface vocabulary, CLI command routes are surface accommodations. The surface entry is the command. The command path is the CLI-local realization of an approach. A CLI alias is an alternate approach to the same trail contract.

CLI command routes are projection metadata, not behavior. The operational test is:

> A CLI command route is valid only if it can be normalized into the same trail
> contract without lying.

Every command route for a trail resolves to the same authored trail:

- same input schema;
- same output schema;
- same `Result` boundary;
- same blaze;
- same permit requirements;
- same intent;
- same error taxonomy.

Different command paths may bind path segments, flags, or defaults into the same input object. They may not create a second contract.

### Default derivation stays the normal path

Most trails author no CLI metadata.

```ts
trail('wayfind.search', {
  input,
  output,
  blaze,
});
```

The CLI derives the canonical command path from the trail ID:

```text
wayfind search
```

The author writes nothing unless derivation is wrong or compatibility requires an extra command path.

### Canonical overrides are projection overrides

When the derived command path is wrong, the trail may override only the CLI projection.

```ts
trail('wayfind.search', {
  cli: 'wayfind search',
  input,
  output,
  blaze,
});
```

This does not create a new surface contract. It changes the projected command path for the same trail.

### String aliases are sibling leaf aliases

A string alias is a single command segment. It means "same parent path, different leaf."

```ts
trail('wayfind.search', {
  cli: {
    aliases: ['find'],
  },
  input,
  output,
  blaze,
});
```

The canonical path remains:

```text
wayfind search
```

The alias resolves to:

```text
wayfind find
```

Multi-segment strings are rejected. If an alias needs a full path, it uses the absolute segment form.

Bad:

```ts
cli: {
  aliases: ['wayfind find'],
}
```

Good:

```ts
cli: {
  aliases: [['wayfind', 'find']],
}
```

The shorthand removes repeated prefixes without making command resolution magical.

### Segment arrays are absolute command paths

An array alias is an absolute command path.

```ts
trail('wayfind.search', {
  cli: {
    aliases: [['wf', 'search']],
  },
  input,
  output,
  blaze,
});
```

This resolves to:

```text
wf search
```

Absolute aliases are explicit because they can cross out of the canonical parent path.

### Surface-owned aliases live with the CLI surface

Some aliases belong to the app or distribution instead of the trail. They may exist for migration, compatibility, or local command ergonomics.

Those aliases live on the CLI surface configuration, following the surface facet precedent. They target trail IDs, not repeated canonical command strings.

```ts
await surface(app, {
  aliases: {
    'wayfind.search': ['find', ['wf', 'search']],
  },
});
```

The surface owns the authoring context, but the aliases do not remain private to the adapter. They must flow into the resolved CLI projection so schema output, Wayfinder, Warden, and agents can inspect the real CLI contract.

### Trails do not carry breadcrumbs for surface-owned aliases

A trail does not need a marker saying an app-level alias exists elsewhere. That marker would be duplicate authored state and would drift from the surface configuration the moment someone forgot to update it.

The framework solves author awareness through inspection:

- Wayfinder shows all command paths for a trail.
- Schema output shows canonical path, aliases, source, and target.
- Topographer serializes trail-owned CLI projection facts, and may include
surface-owned aliases when the deriving surface provides that context.
- Warden validates alias target existence, collisions, and stale migration
paths.

If graph visibility fails to solve a concrete drift problem, a later ADR may add an authored policy marker. It is not part of this decision.

### Trail forks stay out of CLI route metadata

An alternate command path becomes a trail fork when it would change intent, permit requirements, error meaning, output meaning, lifecycle, side effects, or which trail is actually running.

Trail forks are not represented as CLI route metadata. They become distinct trails, composing trails, or surface facets that preserve member identity.

### Resolved CLI projections record the route story

The authored API stays terse. The resolved projection carries the full command route story.

```ts
{
  target: 'wayfind.search',
  canonical: ['wayfind', 'search'],
  routes: [
    {
      path: ['wayfind', 'search'],
      source: 'derived',
      kind: 'canonical',
    },
    {
      path: ['wayfind', 'find'],
      source: 'trail',
      kind: 'alias',
    },
    {
      path: ['wf', 'search'],
      source: 'surface',
      kind: 'alias',
    },
  ],
}
```

The resolved projection is the surface truth. Commander materializes it. The graph explains it.

### Conditional input mappings are deferred

Some command shapes are not simple aliases.

```text
baller analysis <manager>
baller managers justin --analysis
```

Both may be able to normalize into the same trail input. That idea is valid, but the selector and preset language is not part of the first implementation.

This is deferred because conditions such as `when: { flag: 'analysis' }` can become a miniature CLI authoring language. The release-candidate scope supports canonical overrides and aliases only.

When input mappings return, they must satisfy the same normalization test: can this shape normalize into the same trail contract without lying?

If not, the alternate command must be a separate trail, usually a small composing trail.

## Consequences

### Authored ceremony stays low

The common case remains no CLI metadata. The first authored escape hatch is a single canonical override or a sibling alias.

### The CLI surface remains a peer surface

CLI command routes do not make CLI behavior more authoritative than MCP or HTTP. They are surface projection facts over the same trail contract.

### Warden has a clear review test

Warden and reviewers can ask one question: can every route normalize into the same trail contract without lying?

Day-one governance should include:

- command path and alias collision checks;
- app-owned alias target existence checks;
- single-segment grammar for string aliases;
- deprecated alias guidance when deprecations are introduced;
- structural enforcement that aliases cannot carry permit, intent, output, or
blaze changes.

### Schema output becomes more valuable to agents

Agents need a compact way to discover accepted command forms without reading source. CLI schema output should expose canonical command paths, aliases, target trail IDs, input and output schemas, examples, and surface metadata.

This is a direct extension of "one write, many reads": the trail owns the contract, and the CLI schema is one more read of that contract.

## Non-Goals

- This ADR does not add conditional input mappings.
- This ADR does not create a generic command DSL.
- This ADR does not make aliases change permit, intent, output, or error
behavior.
- This ADR does not require every compatibility alias to be trail-authored.
- This ADR does not replace facets. Facets group many trails into one surface
affordance; aliases provide alternate command paths into one trail.

## References

- [ADR-0008](../0008-deterministic-trailhead-derivation.md)
- [ADR-0019: Hierarchical Command Trees From Trail IDs](../0019-hierarchical-command-trees-from-trail-ids.md)
- [ADR-0035: Surface APIs Render The Graph](../0035-surface-apis-render-the-graph.md)
- [ADR-0047: Stable Release Line Discipline](../0047-stable-release-line-discipline.md)
- [Tenets](../../tenets.md)
- [CLI Surface](../../surfaces/cli.md)
- [Surface Facets draft](20260603-surface-facets-shape-dense-topos.md)
