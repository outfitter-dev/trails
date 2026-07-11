# Trailheads

Trailheads group and select without merging. They expose related trails through one surface affordance while preserving the trails themselves. They are useful when a dense topo is still semantically clear but a surface becomes hard to scan.

MCP hits this pressure first. MCP clients often load tool names, descriptions, input schemas, output schemas, and examples into agent context. A flat one-trail-one-tool projection stays faithful, but it can make a dense operator surface expensive to inspect. A trailhead lets the surface say "these trails belong together here" while the trail contracts remain the source of truth.

Trailheads are not a core `Facet` primitive. Do not look for `facet()`, do not create a shared `Facet` type, and do not add trailhead authoring configuration to adapter-kit.

A trailhead is a surface accommodation on the entry axis: one grouped surface entry over several trails. It is not an alternate approach to one trail. Aliases and input mappings are N-to-1 accommodations that converge on one trail contract; trailheads are 1-to-N accommodations that gather several trails while preserving member identity. See [ADR-0050](../adr/0050-surface-accommodations-preserve-trail-identity.md) and [Surface Accommodations](surface-accommodations.md) for the full vocabulary.

## When To Use One

Use a trailhead when:

- the underlying trails are still the right product boundary;
- a surface has too many adjacent affordances for agents or users to scan cheaply;
- the grouped affordance can keep the original trail ID visible at invocation and response time;
- the surface can expose resolved metadata so agents can inspect membership without reading source.

Do not use a trailhead when:

- you are really trying to create a new domain operation;
- grouping would hide important trail identity or output shape;
- direct trail projection is already clear enough;
- you need CLI or HTTP parity before MCP has proved the pattern for your app.

The fork test still applies. If a grouped affordance would merge contracts, hide which trail is selected, or introduce an action vocabulary such as `{ action: "create" | "delete" }`, split the capability into distinct trails or a composing trail first. A trailhead may group and select; it must not merge and obscure.

That boundary has two parts:

- **Semantic:** the trailhead does not change member intent, permits, errors, outputs, lifecycle, or side effects.
- **Structural:** the trailhead keeps member trail identity visible at invocation and response time.

## Authoring Channels

Trailheads have two authoring channels that share one implementation:

- **The overlay default.** An `mcp` list binding in the app's `surfaceOverlay({ mcp })` authors the grouped entry once: it lands in `trails.lock` under `overlays.surfaces`, projects into the graph's trailhead facts for Wayfinder reads, and the MCP surface derives the grouped tool from it with a deterministic default description. This is the authored, lockable default.
- **The call-site override.** The `trailheads` option in MCP surface options carries the same grouped entry with richer metadata: authored prose, deferred loading, visibility acknowledgements. This is override-in-context by design, not a compatibility bridge: when both channels are present, the call-site map wins at runtime.

### Overlay Default

```typescript
import { surfaceOverlay } from '@ontrails/core';
import { surface } from '@ontrails/mcp';
import { graph } from './app';

export const appOverlays = [
  surfaceOverlay({
    mcp: {
      inspect: ['survey', 'survey.diff', 'topo', 'guide'],
    },
  }),
];

await surface(graph, { overlays: appOverlays });
```

`trails compile` embeds the bindings in the lock and derives trailhead facts from the list bindings, so agents can read grouped-entry membership from the committed graph without loading surface code.

### Call-Site Override

`@ontrails/mcp` accepts the `trailheads` option in surface options:

```typescript
import type { McpSurfaceTrailheadMap } from '@ontrails/mcp';
import { surface } from '@ontrails/mcp';
import { appOverlays, graph } from './app';

const trailheads = {
  governance: {
    description:
      'Run project diagnostics, adapter readiness checks, and Warden guidance.',
    mcp: { loading: 'deferred' },
    trails: ['doctor', 'adapter.check', 'warden', 'warden.guide'],
  },
  inspect: {
    description:
      'Inspect topo structure, contracts, resources, signals, surfaces, and diffs.',
    mcp: { loading: 'deferred' },
    trails: ['survey', 'survey.diff', 'topo', 'guide'],
  },
} satisfies McpSurfaceTrailheadMap;

await surface(graph, {
  overlays: appOverlays,
  trailheads,
  mcpResources: { examples: true, surfaceMap: true },
});
```

Keep the override aligned with the authored overlay default. Warden's `trailhead-override-divergence` rule warns when a call-site map's binding names or member selectors diverge from the app's authored `mcp` list bindings, so an agent reading the lock is not misled about what the running surface projects. Intentional divergence is legal; make it visible by renaming one side.

Prefer explicit lists for editorial groups. Glob selectors such as `topo.*` reuse the normal surface filtering grammar, but broad selectors need more care: membership drift can make descriptions stale and can create trailhead overlap.

## MCP Projection Shape

Each MCP trailhead projects as one MCP tool named from the topo name and trailhead ID. A `governance` trailhead in topo `trails` derives `trails_governance`.

The input schema requires a trail discriminator plus the selected trail input:

```json
{
  "trail": "warden",
  "input": {
    "apps": ["apps/trails/src/app.ts"]
  }
}
```

The handler runs the selected constituent trail through the same MCP execution path as an ordinary one-trail-one-tool projection. It does not call an implementation directly, and it does not invent a second behavior path for the grouped entry.

Successful outputs are correlated with the selected trail:

```json
{
  "trail": "warden",
  "output": {
    "errors": 0,
    "warnings": 0
  }
}
```

That envelope is intentional. A trailhead can contain trails with different output schemas, so the returned trail ID must stay visible for agents and downstream readers. If a proposed grouped tool would remove that correlation, it has become a trail fork rather than a trailhead.

## Visibility And Overlap

Trail visibility remains authoritative. A trailhead may narrow the projection, but it cannot make an internal trail public. If a public trailhead selector matches an internal trail, runtime projection omits that internal member.

Trailhead selector overlap is treated as drift. Narrow the selectors instead of adding an escape hatch. The rejected shape is `overlapsWith`; it would let a map silence ambiguity without clarifying ownership.

When a trailhead intentionally spans visibility tiers, record the acknowledgement:

```typescript
const trailheads = {
  ops: {
    description: 'Operator-only diagnostics.',
    trails: ['doctor', 'dev.*'],
    visibilityWideningAccepted: true,
  },
} satisfies McpSurfaceTrailheadMap;
```

The acknowledgement does not widen runtime behavior. It only tells governance that the author saw the mixed-visibility grouping.

## Description Drift

Trailhead descriptions are authored prose over resolved membership. If the member set changes, the description may become false even when every individual trail is valid.

Use `descriptionStableThrough` only when the description is intentionally stable through a known member-set hash. Do not use it as routine noise suppression.

```typescript
const trailheads = {
  inspect: {
    description: 'Inspect topo state and generated artifacts.',
    descriptionStableThrough: 'sha256:...',
    trails: ['survey', 'topo.*'],
  },
} satisfies McpSurfaceTrailheadMap;
```

## MCP Resources

Use MCP resources for cold context. The default MCP surface exposes:

- `trails://surface-map` for the resolved MCP surface projection;
- `trails://examples/<trailId>` for structured examples on exposed trails.

The surface map includes ordinary tools and trailhead tools. Trailhead entries expose `trailheadId`, `memberTrailIds`, input/output schemas, annotations, and deferred-loading hints.

The phrase is **MCP resources**. Trails `resource()` still means an infrastructure dependency declared on a trail contract.

## Adapter-Kit Boundary

Adapter-kit does not author trailheads. It may expose raw adapter evidence, such as `adapterType` and target conformance paths, that future surface or governance checks can interpret against resolved projection metadata.

If an adapter claims grouped affordances later, the validator should consume resolved surface data: trailhead ID, member trail IDs, effective visibility, description, member-set hash, and `{ trail, output }` correlation shape. No adapter target is required to support grouping unless it explicitly claims that capability.

## CLI And HTTP

CLI and HTTP parity are deferred. CLI should be evaluated as command-group consolidation, not as an MCP-style generic action tool. HTTP should be evaluated as route-group projection, OpenAPI organization, or a rejected non-fit. See [Trailhead Parity](surface-trailhead-parity.md) for the current decision.
