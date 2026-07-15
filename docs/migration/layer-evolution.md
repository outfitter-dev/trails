# Layer Evolution Migration Guide

How to migrate apps off the legacy layer model onto the typed `Layer` model that ships with Trails today. See [ADR-0043: Layer Evolution](../adr/0043-layer-evolution.md) for the full rationale.

## Overview

Three things changed:

1. **Framework concerns moved into the pipeline.** Auth enforcement and execution recording are intrinsic stages in `executeTrail`, derived from `trail.permit` and tracing config.
2. **CLI-specific layers moved into surface derivation.** Pagination (`--all`, auto-iteration) and date shortcuts (`since=last-week`) derive from schema shape on the CLI surface, not authored layers.
3. **`Layer` is now a typed primitive with optional `input`.** Layers can declare an `input` Zod schema that renders onto CLI flags, MCP parameters, and HTTP query/body fields. Layers without `input` remain surface-invisible wrappers for runtime-only concerns such as tenant guards, rate limiting, circuit breaking, and custom audit logging.

There is no rename away from `executeTrail({ layers })`. That option is canonical and undeprecated.

## Removed Exports

### `authLayer` from `@ontrails/permits`

Permit enforcement is now intrinsic to `executeTrail`. The pipeline reads `trail.permit`, checks `ctx.permit` against the declared scopes, and returns `Result.err(PermitError)` before execution enters the implementation. No layer to wire.

```diff
- import { authLayer } from '@ontrails/permits';
-
  const billingCharge = trail('billing.charge', {
    input: ChargeSchema,
    output: ReceiptSchema,
-   layers: [authLayer],
+   permit: { scopes: ['billing:write'] },
    implementation: chargeImplementation,
  });
```

A trail with `permit` is protected on every surface automatically. See [TRL-475] for the removal commit.

### `autoIterateLayer` from `@ontrails/cli`

Pagination is now auto-derived. A trail whose output schema matches `z.object({ items, hasMore, nextCursor })` automatically gets a `--all` flag on its CLI command, and the CLI iterates pages on the caller's behalf.

```diff
- import { autoIterateLayer } from '@ontrails/cli';
-
- surface(app, {
-   cli: { layers: [autoIterateLayer] },
- });
+ // Nothing to wire. The CLI surface derives pagination from output shape.
```

To opt out on a single trail, set `surface: { cli: { autoIterate: false } }` on the trail spec.

### `dateShortcutsLayer` from `@ontrails/cli`

Date shortcuts are now auto-derived. A trail with date-like input fields accepts shortcut values such as `today`, `yesterday`, `7d`, `30d`, `this-week`, and `this-month` from the CLI.

```diff
- import { dateShortcutsLayer } from '@ontrails/cli';
-
- surface(app, {
-   cli: { layers: [dateShortcutsLayer] },
- });
+ // Nothing to wire. The CLI surface derives shortcuts from input shape.
```

To opt out on a single trail, set `surface: { cli: { dateShortcuts: false } }` on the trail spec.

## Authored Layers

Use a typed `Layer` when behavior should wrap trail execution. Add `input` only when the behavior needs surface-visible fields.

```typescript
import type { Layer } from '@ontrails/core';
import { z } from 'zod';

const dryRun: Layer = {
  name: 'dry-run',
  description: 'Preview the trail without executing side effects.',
  input: z.object({
    dryRun: z.boolean().default(false).describe('Preview without executing'),
  }),
  wrap: (trail, impl) => async (input, ctx) => {
    if ((input as { dryRun?: boolean }).dryRun) {
      return Result.ok({ preview: true, wouldExecute: trail.id });
    }
    return impl(input, ctx);
  },
};
```

Attach layers at the right scope:

```typescript
// Per trail: applies to one trail on every surface.
trail('gist.create', { /* ... */, layers: [dryRun, audit] });

// Per surface: applies to every trail on one surface.
surface(app, {
  cli: { layers: [verbose, outputFormat] },
  mcp: { layers: [progress] },
  http: { layers: [cors, compression] },
});

// Per topo: applies to every trail on every surface.
const app = topo('myapp', { trails }, { layers: [telemetry] });
```

Composition order is `topo -> surface -> trail -> execution-supplied -> implementation`. Topo layers run outermost; execution enters the implementation innermost.

## Runtime-Only Wrappers

Do not introduce a separate wrapper type for runtime-only behavior. Use a `Layer` without an `input` schema:

```typescript
const tenantGuard: Layer = {
  name: 'tenant-guard',
  wrap: (_trail, impl) => async (input, ctx) => {
    if (ctx.permit?.tenantId !== (input as { tenantId?: string }).tenantId) {
      return Result.err(new PermitError('tenant mismatch'));
    }
    return impl(input, ctx);
  },
};

await executeTrail(trail, input, { layers: [tenantGuard] });
```

This keeps one cross-cutting primitive in the framework: a named, inspectable `Layer`. If a bare function wrapper becomes necessary later, ADR-0043 defines the conditions for reintroducing it.

## Surface Rendering

Layer `input` schemas render automatically onto every surface a trail is exposed on:

| Surface | Rendering | Reference |
| --- | --- | --- |
| CLI | One flag per field, such as `--dry-run`, `--page`, `--limit` | [TRL-473] |
| MCP | Fields merged into the tool's `inputSchema` | [TRL-474] |
| HTTP | Query string for reads, request body for writes | [TRL-474] |

Layer inputs and trail inputs share a flat namespace. When a layer field collides with a trail input field, the layer field is renamed to `<layerName>-<originalField>` on the surface and a one-shot stderr warning is emitted. Persistent collisions should be treated as authored errors.

## Warden Coaching

One warden rule guards the migration:

- **`no-legacy-layer-imports`** (error) flags any import or reference to `authLayer`, `autoIterateLayer`, or `dateShortcutsLayer`.

Run `bun run lint` after migration to verify stale references are gone.

## References

- [ADR-0043: Layer Evolution](../adr/0043-layer-evolution.md)
- [ADR-0006: Shared Execution Pipeline](../adr/0006-shared-execution-pipeline.md)
- [ADR-0012: Adapter-Agnostic Permits](../adr/0012-connector-agnostic-permits.md)
- [ADR-0041: Unified Observability](../adr/0041-unified-observability.md)

[TRL-473]: https://linear.app/outfitter/issue/TRL-473
[TRL-474]: https://linear.app/outfitter/issue/TRL-474
[TRL-475]: https://linear.app/outfitter/issue/TRL-475
