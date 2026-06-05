# @ontrails/wayfinder

Agent-shaped wayfinding query trails over `@ontrails/topographer` artifacts.

`@ontrails/wayfinder` lets agents query a Trails app's resolved topo without
re-deriving the graph from `grep` plus file reads. The v0 catalog is cold and
deterministic: it reads existing Topographer artifacts (`topo.lock`,
`trails.lock`, and materialized current `trails.db` topo-store records) without
starting apps, booting resources, reaching the network, or mutating local state.

The package exports `wayfinderTopo` plus individual graph-read trails:

- `wayfind.overview`
- `wayfind.search`
- `wayfind.trails`
- `wayfind.contours`
- `wayfind.resources`
- `wayfind.signals`
- `wayfind.surfaces`
- `wayfind.facets`
- `wayfind.versions`
- `wayfind.examples`
- `wayfind.describe`
- `wayfind.contract`
- `wayfind.nearby`
- `wayfind.impact`
- `wayfind.diff`

Each trail is internal by default and returns provenance and freshness metadata
with its result so callers can tell whether the answer came from fresh
artifacts, stale artifacts, missing artifacts, or schema-version drift. Public
surface exposure must be a deliberate host decision.

```ts
import { wayfinderTopo } from '@ontrails/wayfinder';
import { surface } from '@ontrails/mcp';

await surface(wayfinderTopo, {
  include: ['wayfind.overview', 'wayfind.search', 'wayfind.describe'],
});
```

Keep included Wayfinder trails behind a host-owned authorization boundary.
Wildcard includes such as `['**']` do not expose internal trails.

## Overview

Use `wayfind.overview` to inspect the saved graph shape before asking narrower
questions.

```ts
import { createTrailContext } from '@ontrails/core';
import { wayfindOverviewTrail } from '@ontrails/wayfinder';

const result = await wayfindOverviewTrail.blaze(
  { rootDir: process.cwd() },
  createTrailContext()
);
```

The output includes counts for trails, contours, resources, signals, surfaces,
facets, versions, and examples, along with the TopoGraph artifact source.

## Typed Filtering

`wayfind.search` and the list trails use the same typed filter kit. Filters are
explicit fields, not a query mini-language.

```ts
import { wayfindSearchTrail } from '@ontrails/wayfinder';

const result = await wayfindSearchTrail.blaze(
  {
    filters: {
      kind: 'trail',
      namespace: 'user',
      surface: 'mcp',
      usesResource: 'db.main',
    },
    limit: 50,
    rootDir: process.cwd(),
  },
  createTrailContext()
);
```

Supported filters include entity kind, exact ID, ID prefix, namespace, intent,
surface, facet, versioning, example coverage, resource usage, and signal usage.
Use `createWayfinderGraphEntityPredicate` or `filterWayfinderEntityRefs` when
matching relationship filters directly in code so facet membership and projected
surfaces are evaluated with graph-derived context.

## Describe And Contract

Use `wayfind.describe` when you need the saved topo entity and
`wayfind.contract` when you only need the input/output contract shape.

```ts
import {
  wayfindContractTrail,
  wayfindDescribeTrail,
} from '@ontrails/wayfinder';

await wayfindDescribeTrail.blaze(
  { id: 'user.create', kind: 'trail', rootDir: process.cwd() },
  createTrailContext()
);

await wayfindContractTrail.blaze(
  { id: 'user.create', rootDir: process.cwd() },
  createTrailContext()
);

await wayfindContractTrail.blaze(
  { id: 'user.create', kind: 'version', rootDir: process.cwd(), version: 1 },
  createTrailContext()
);
```

Missing IDs return `Result.err(new NotFoundError(...))`, preserving Trails'
surface error mapping instead of returning ambiguous empty objects.

## Surfaces, Facets, Versions, And Examples

`wayfind.surfaces` includes both directly projected trail surfaces and
facet-projected surfaces. `wayfind.facets` returns facet membership, visibility,
and descriptions. `wayfind.versions` returns current and historical trail
versions. `wayfind.examples` lists saved examples without executing any trail.

## Nearby, Impact, And Diff

`wayfind.nearby` returns the direct saved graph relationships around one entity.
The relation graph is typed and deterministic: resources point to trails that
use them, signals point to producing or consuming trails, surfaces and facets
point to projected member trails, composed trails point to their composers, and
trails point to saved version records.

```ts
import {
  wayfindDiffTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
} from '@ontrails/wayfinder';

await wayfindNearbyTrail.blaze(
  { id: 'user.create', kind: 'trail', rootDir: process.cwd() },
  createTrailContext()
);

await wayfindImpactTrail.blaze(
  {
    id: 'db.main',
    kind: 'resource',
    maxDepth: 2,
    rootDir: process.cwd(),
  },
  createTrailContext()
);

await wayfindDiffTrail.blaze(
  {
    againstRootDir: '/path/to/baseline-workspace',
    rootDir: process.cwd(),
  },
  createTrailContext()
);
```

`wayfind.impact` walks those typed relation edges with `downstream`,
`upstream`, or `both` direction. `downstream` follows the stored edge direction,
which is oriented from contract substrate to affected graph members:
resource-to-trail, signal-to-trail, surface-to-trail, facet-to-trail,
composed-trail-to-composer, and trail-to-version. `wayfind.diff` compares two
saved TopoGraph artifacts with `deriveTopoGraphDiff`; it requires an explicit
`againstDir` or `againstRootDir` baseline instead of deriving either graph from
live source.

These queries are intentionally graph-read only. They do not provide
`wayfind.query`, semantic search, signposts, or implications yet.
