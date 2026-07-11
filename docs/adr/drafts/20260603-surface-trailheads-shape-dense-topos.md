---
slug: surface-trailheads-shape-dense-topos
title: Surface Trailheads Shape Dense Topos
status: draft
created: 2026-06-03
updated: 2026-06-13
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 17, 27, 35, 42, 46, 50]
linear:
  - TRL-902
---

# ADR: Surface Trailheads Shape Dense Topos

## Context

Small Trails apps can project one trail to one surface affordance and remain clear. Dense topos eventually cross a threshold where that projection stops being ergonomic. MCP reaches the threshold first because tool schemas live in the agent's working context and are re-read repeatedly. CLI and HTTP have different economics, but the underlying pressure is the same: some surfaces need a grouped projection over a set of trails without changing the trail definitions themselves.

The current one-trail-one-tool MCP projection is faithful but flat. An app like the Trails CLI has many related trails: survey, guide, warden, topo inspection, draft promotion, dev utilities, and release helpers. Projecting every trail as an independent MCP tool creates tool overload and makes cold-start inspection harder for agents.

At the same time, Trails cannot solve this by adding a new authored primitive casually. The tenets still apply:

- the trail remains the product;
- one authored contract should feed many readers;
- surface APIs render the graph rather than owning new domain behavior;
- the resolved topo artifact family is the inspectable story;
- new concepts must reduce real ceremony without fragmenting the framework.

The useful shape is a **surface trailhead**: a surface-side projection slice over existing trails. It groups related trails into one surface affordance while preserving the underlying trail identity, schemas, output contracts, examples, errors, visibility, composition, and governance.

This ADR decides the surface-trailhead pattern and the first MCP implementation. It does not create a generic grouped-entry primitive.

## Decision

### Surface trailheads are a projection pattern, not graph nodes

A surface trailhead is authored as surface projection configuration over existing trails. It is not a trail, entity, resource, signal, layer, or new graph entry kind.

```ts
await surface(graph, {
  trailheads: {
    topo: {
      trails: ['survey', 'guide', 'topo.*'],
      description: 'Read and inspect topo state.',
      mcp: { loading: 'deferred' },
    },
    dev: {
      trails: 'dev.*',
      description: 'Operator and developer utilities.',
      visibility: 'internal',
    },
  },
});
```

The authored information is intentionally small: a trailhead ID, a selector, a description, and optional surface-specific projection hints. Everything else derives from the constituent trails.

The former `facet` name is retired for this pattern. `trailhead` is the concrete grouped surface entry name in this ADR. `schema facet` remains available as descriptive schema-slice prose, but it is not decided here as an API.

In the broader surface-accommodation vocabulary, a surface trailhead is a grouped surface entry. It lives on the entry axis: one surface entry gathers multiple trails while preserving member identity. It is not an alternate approach to one trail. Aliases and input mappings converge on one trail contract; trailheads group several contracts without merging them.

### Selectors reuse trail surface filtering semantics

Trailhead membership reuses the trail ID selector grammar already established for surface filtering:

- glob selectors express namespace identity, such as `topo.*`;
- explicit lists express editorial membership;
- exact IDs keep their exact meaning;
- overlap is resolved by narrowing selectors, not by declaring permission to overlap.

The rejected shape is `overlapsWith`. A declaration that says "this overlap is allowed" lets authors silence drift without fixing the projection. The right fix is to make membership unambiguous or to keep the overlap visible as a Warden finding until the pattern proves it should be allowed.

### MCP trailheads project as discriminated tools

In `@ontrails/mcp`, a trailhead projects as one MCP tool. The input discriminator is `trail`, carrying the full constituent trail ID. The input payload is nested under `input` so the trail contract remains visible rather than being flattened into a surface-specific action bag.

```ts
{
  trail: 'topo.describe',
  input: {
    root: '.',
  },
}
```

The handler dispatches to the selected constituent trail through the same surface execution path that ordinary MCP tools use. The trailhead does not call an implementation directly and does not create a second implementation path.

This is grouped selection, not a hidden action bag. The selected trail ID is the member identity, and the selected member's input schema remains the contract for the nested `input` payload.

Outputs are correlated with the same trail ID:

```ts
{
  trail: 'topo.describe',
  output: {
    /* constituent output */
  },
}
```

This envelope is required. A heterogeneous trailhead output must remain understandable to agents and machine readers after the call returns. The output schema therefore stays object-rooted for MCP compatibility and carries `{ trail, output }` at the top level instead of relying on branch order, implicit action names, or uncorrelated unions.

### Trailheads do not hide trail forks

A trailhead should not be used to launder a new operation into one surface affordance. If grouping would change intent, permit requirements, error meaning, output meaning, lifecycle, side effects, or hide which trail actually runs, the shape has found a trail fork. Author distinct trails or a composing trail first, then use a trailhead only if the surface still needs a grouped entry that preserves the selected member trail.

### Visibility never widens through a trailhead

Trail visibility remains authoritative. A trailhead may narrow exposure, but it cannot make a more restrictive member visible on a wider surface.

Runtime projection applies the more restrictive boundary. If an internal trail appears in a public trailhead selector, that trail is absent from the public projection. Author-time governance should flag the mismatch so the author can narrow the selector, narrow the trailhead, or acknowledge that the mixed-visibility grouping is intentional.

The acknowledgement field is explicit:

```ts
visibilityWideningAccepted: true
```

This does not change runtime behavior. It only records that the author understands the trailhead spans visibility tiers and that runtime exclusion is expected.

### Trailhead descriptions are governed by resolved membership

A trailhead description is authored prose. Its truth depends on resolved membership. Routine namespace growth should not force needless copy changes, but major membership drift should be visible.

The resolved topo artifact family records trailhead metadata as a top-level projection, not as graph entries:

```ts
interface TopoGraphTrailheadEntry {
  readonly id: string;
  readonly description: string;
  readonly memberIds: readonly string[];
  readonly memberSetHash: string;
  readonly surfaces: readonly string[];
  readonly visibility?: 'public' | 'internal' | undefined;
  readonly descriptionStableThrough?: string | undefined;
  readonly visibilityWideningAccepted?: true | undefined;
}
```

The top-level field is `trailheads?: readonly TopoGraphTrailheadEntry[]`. This follows the existing `workspace` precedent in the topo graph: trailhead membership is a projection over the graph, not an ordinary `entries[]` node.

`memberIds` are resolved and sorted. `memberSetHash` is a stable hash of the sorted member ID list. The hash lets semantic diff and Warden distinguish a harmless regeneration from a real membership change.

The description escape hatch is:

```ts
descriptionStableThrough: 'sha256:...'
```

When this value matches the new member-set hash, governance can treat the existing description as intentionally stable. When it does not match, cross-namespace churn, large membership changes, splits, and merges can produce Warden findings.

### Durable trailhead metadata requires compile-time access

Trailhead projection can run at surface runtime, but lockfile drift protection requires compile-time visibility. A trailhead declared only inside an effectful `surface()` call cannot appear in `.trails/topo.lock` unless the compile pipeline receives the same declaration.

Therefore implementations must provide a compile-time-readable path for trailhead declarations. The exact host may be project config, explicit topography options, or a future surface config artifact. The requirement is the important part: durable trailhead metadata is derived from the graph plus compile-time trailhead declarations, not from executing a live surface.

If a caller uses runtime-only trailheads, the MCP projection may still work, but the resolved topo artifact family cannot promise drift protection for that trailhead. That limitation must stay visible in docs and diagnostics.

### MCP resources are cold context

`@ontrails/mcp` should project cold context as MCP resources, not tools. The phrase is always **MCP resources** to avoid collision with the Trails `resource()` primitive.

The first resource set is:

- `trails://surface-map` for the resolved MCP surface projection, including ordinary tools and trailhead tools;
- per-trail example resources where the app exposes examples to MCP clients;
- trailhead metadata as part of the surface map, not a separate required resource in v0.

MCP resources are surface-side projection. They do not change the trail contract and do not create new Trails resources.

### Deferred loading is a compatibility hint

Trailheads may carry:

```ts
mcp: { loading: 'deferred' }
```

The MCP protocol and SDK still require broad compatibility with clients that expect full schemas in `tools/list`. The v0 implementation therefore treats deferred loading as metadata, not as permission to omit required schemas. Clients that understand the hint can choose to de-prioritize or lazily inspect the heavier schema. Other clients continue to work.

### Adapter-kit consumes evidence, not trailhead definitions

Runtime adapter packages may need to understand surface projection metadata later. That does not mean `@ontrails/adapter-kit` should author or define trailheads.

The dependency direction is:

- adapter-kit emits raw adapter evidence, such as `adapterType`;
- topography, Warden, or surface packages interpret that evidence against resolved trailhead declarations;
- adapter-kit does not import topography and does not learn the trailhead ontology.

The seam is intentionally asymmetric:

- **contract-content conformance** remains adapter-kit's job. It answers whether an adapter package is placed correctly, declares its owner target, exports the expected entrypoints, and carries target conformance tests.
- **surface-projection conformance** belongs to the surface or governance layer that already has the resolved projection. It may ask whether a grouped affordance is backed by resolved data such as trailhead ID, member trail IDs, effective visibility, description, member-set hash, and `{ trail, output }` correlation.

No adapter target is required to support grouping. A future adapter can claim grouped affordances explicitly, but the validator for that claim should consume resolved surface projection evidence instead of adding trailhead authoring configuration to adapter-kit. The current adapter-kit seam is the existing raw subject evidence (`adapterType`, owner package, placement, target, conformance paths); it is sufficient for this stack because MCP trailhead projection is owned by `@ontrails/mcp` and Topography, not by adapter authoring.

### Wayfinder reads trailheads directly, not through a projections bucket

Wayfinder treats resolved surface trailheads as first-class graph-read facts. Agents should be able to ask `wayfind.surfaces` and `wayfind.trailheads` directly instead of routing through a generic `wayfind.projections` endpoint.

The projection doctrine still matters: one authored trail contract mechanically renders into many surface affordances. Wayfinder carries that doctrine through per-fact provenance (`derivedFrom`) and through specific queries over resolved surface facts. A generic projections endpoint remains deferred until field evidence shows a reverse-index need that `describe`, `contract`, `surfaces`, `trailheads`, `nearby`, `impact`, and `derivedFrom` do not satisfy.

### Non-decisions

This ADR does not decide:

- a generic grouped-entry primitive or `facet()` API;
- CLI or HTTP trailhead APIs beyond preserving the conceptual room for them;
- code-mode MCP execution such as `execute({ code })`;
- an `mcp.search` trail, which remains wayfinder territory;
- a generic `wayfind.projections` endpoint;
- MCP prompts;
- auto-generated trailhead descriptions.

## Consequences

### Positive

- Dense MCP surfaces can reduce tool overload without changing trail definitions.
- Agents receive correlated outputs and can tell which underlying trail produced a result.
- Surface grouping stays inspectable through resolved metadata instead of disappearing into hand-written per-app glue.
- Visibility and filtering reuse established doctrine rather than inventing new exposure rules.
- Adapter-kit gets room to participate through structural evidence without taking a dependency on trailhead semantics.

### Tradeoffs

- Surface authors must learn one new projection shape.
- Lockfile drift protection only works for trailhead declarations available to compile-time tooling.
- MCP trailhead input nesting adds one level of structure around the constituent trail input.
- Warden rules for overlap, visibility widening, and description drift need careful false-positive control before they become hard errors.

### Risks

- If the first implementation treats trailheads as runtime-only, the resolved topo artifact family will be incomplete and agents will get a weaker story than the ADR promises.
- If docs over-teach trailheads as a new primitive, developers may start looking for a generic grouped-entry API instead of understanding projection from existing trails.
- If output correlation is optional, heterogeneous trailhead tools will become agent-hostile quickly.

### Distribution follow-through

This decision is not distribution-ready until the implementation stack updates:

- MCP package docs and examples;
- topography lockfile/schema docs where trailhead metadata serializes;
- Warden guidance for overlap, visibility, and description drift;
- Trails skill and plugin guidance for agents;
- changesets and release notes for package-impacting work;
- migration notes for apps that want to replace raw one-trail-one-tool MCP projection with trailhead projection.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) - the trail remains the product and surfaces render the contract
- [ADR-0017: The Serialized Topo Graph](../0017-serialized-topo-graph.md) - resolved graph inspection and drift protection
- [ADR-0027: Trail Visibility and Surface Filtering](../0027-visibility-and-filtering.md) - selector grammar and visibility semantics
- [ADR-0035: Surface APIs Render the Graph](../0035-surface-apis-render-the-graph.md) - `derive*`, `create*`, and `surface()` projection ladder
- [ADR-0042: Core/Topography Boundary Doctrine](../0042-core-topography-boundary-doctrine.md) - durable graph artifacts belong to topography
- [ADR-0046: Lock v3 Artifact Family](../0046-lock-v3-artifact-family.md) - `.trails/topo.lock` as the inspectable topo content artifact
- [ADR-0050: Surface Accommodations Preserve Trail Identity](../0050-surface-accommodations-preserve-trail-identity.md) - surface accommodation vocabulary and fork test

This draft formalizes the earlier scratch planning captures for surface trailheads and MCP shaping. Those scratch notes are local planning state, not committed reference material.
