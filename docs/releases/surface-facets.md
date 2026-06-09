# Surface Facets Release Notes

Surface facets are an additive beta feature for dense MCP surfaces. They let an MCP surface group related trails into fewer tools while preserving the original trail contract, trail ID, input schema, output schema, examples, errors, visibility, and execution path.

## Changed Packages

The Surface Facets & MCP Shaping stack changes these publishable packages:

- `@ontrails/topographer`: serializes resolved facet metadata in TopoGraph artifacts and semantic diffs.
- `@ontrails/mcp`: adds MCP surface facets, MCP resource projection for cold context, and deferred-loading metadata hints.
- `@ontrails/trails`: adds the Trails operator MCP entrypoint and deferred facet map.
- `@ontrails/warden`: adds `surface-facet-coherence` guidance for overlap, dynamic selectors, visibility acknowledgement, and description hygiene.
- `@ontrails/adapter-kit`: exposes adapter type evidence for downstream projection checks without authoring facets.

Each package-touching branch carries a branch-local changeset:

- `.changeset/trl-889-surface-facet-metadata.md`
- `.changeset/trl-892-mcp-surface-facets.md`
- `.changeset/trl-888-trails-operator-mcp-facets.md`
- `.changeset/trl-893-surface-facet-warden.md`
- `.changeset/trl-891-mcp-resource-docs.md`

## What Ships

### MCP Surface Facets

Authors can pass `facets` to `@ontrails/mcp` surface options:

```typescript
await surface(graph, {
  facets: {
    governance: {
      description: 'Run project diagnostics and Warden guidance.',
      mcp: { loading: 'deferred' },
      trails: ['doctor', 'warden', 'warden.guide'],
    },
  },
});
```

Each facet becomes one MCP tool. Calls use the selected trail ID plus nested input:

```json
{ "trail": "warden", "input": { "apps": ["apps/trails/src/app.ts"] } }
```

Successful outputs are correlated:

```json
{ "trail": "warden", "output": { "errors": 0, "warnings": 0 } }
```

### MCP Resources

MCP resources are enabled by default:

- `trails://surface-map` exposes the resolved MCP projection, including ordinary tools and facet tools.
- `trails://examples/<trailId>` exposes structured examples for exposed trails.

Use `mcpResources: false` to disable MCP resources, or a `McpResourcesConfig` object to select `surfaceMap` and `examples` individually.

### Deferred Loading Hint

`mcp: { loading: 'deferred' }` marks a facet tool with `_meta["ontrails/deferred"]`. It is a compatibility hint only. Required schemas still appear in `tools/list` so older clients continue to work.

### Adapter-Kit Boundary

Adapter-kit does not define, author, or own facets. It may provide raw adapter evidence such as `adapterType` for future surface-projection conformance checks, but grouped affordance validation should consume resolved surface metadata from the surface or governance layer.

## Migration Posture

Existing MCP consumers that use one-trail-one-tool projection do not need to migrate. Surface facets are opt-in.

Apps that want a shaped MCP surface should:

1. Keep trail contracts unchanged.
2. Add an explicit MCP facet map near the MCP surface entrypoint.
3. Enable MCP resources or keep the default resource projection.
4. Run Warden and watch for selector overlap, dynamic selectors, visibility widening acknowledgements, and stale descriptions.
5. Update app docs or agent guidance so callers know to inspect `trails://surface-map` before guessing at grouped tools.

CLI and HTTP parity are intentionally deferred. Do not introduce MCP-style generic action envelopes on those surfaces as a migration step.

## Release And Publish Path

Use the normal lockstep beta release flow:

```bash
bunx changeset version
bun run check
bun run test
bun run build
bun run publish:check
bun run publish:packages
bun run publish:registry-check:published
```

`bun run publish:check` and `bun run publish:packages` handle workspace dependency ordering. No extra package ordering is required beyond the existing topological publish flow.

Do not publish from the feature stack unless explicitly authorized. This note is release preparation; publication still happens through the standard release operator sequence.

## Distribution-Ready Gate

Before cutting the beta that includes surface facets, confirm:

- docs include the user-facing facet guide, MCP resource/deferred guidance, and CLI/HTTP parity decision;
- Trails skill/plugin guidance teaches facets as governed surface projection, not a new primitive;
- Warden generated guidance is refreshed and checked;
- `trails release smoke --check wayfinder-dogfood` or the repo wrapper
  `bun run wayfinder:dogfood` proves the Trails operator topo remains
  inspectable through saved Wayfinder graph facts;
- all branch-local changesets are present;
- `bun run check`, `bun run test`, `bun run build`, and `bun run publish:check` pass.
