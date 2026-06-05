# @ontrails/wayfinder

Agent-shaped wayfinding query trails over `@ontrails/topographer` artifacts.

`@ontrails/wayfinder` lets agents query a Trails app's resolved topo without re-deriving the graph from `grep` plus file reads. The v0 catalog is cold and deterministic: it reads existing Topographer artifacts (`topo.lock`, `trails.lock`, and materialized current `trails.db` topo-store records) without starting apps, booting resources, reaching the network, or mutating local state.

The package exports `wayfinderTopo` plus individual graph-read trails.

## V0 Catalog

| Trail | Purpose |
| --- | --- |
| `wayfind.overview` | Summarize saved graph counts, artifact source, and freshness. |
| `wayfind.search` | Find graph entities with typed filters. |
| `wayfind.trails` | List trail summaries with the shared typed filter kit. |
| `wayfind.contours` | List contour summaries with the shared typed filter kit. |
| `wayfind.resources` | List resource summaries and declaring trails. |
| `wayfind.signals` | List signal summaries, producers, and consumers. |
| `wayfind.surfaces` | List saved surface membership facts. |
| `wayfind.facets` | List resolved surface facet metadata and members. |
| `wayfind.versions` | List current and historical trail version records. |
| `wayfind.examples` | List saved examples without executing trails. |
| `wayfind.describe` | Inspect the saved entity record for one ID. |
| `wayfind.contract` | Inspect the input/output/intent contract for one trail or version. |
| `wayfind.nearby` | Return direct typed relation edges around one entity. |
| `wayfind.impact` | Walk upstream, downstream, or both relation directions. |
| `wayfind.diff` | Compare two explicit saved TopoGraph baselines. |

Each trail is internal by default and returns provenance and freshness metadata with its result so callers can tell whether the answer came from fresh artifacts, stale artifacts, missing artifacts, or schema-version drift. Public surface exposure must be a deliberate host decision.

The v0 catalog intentionally does not include `wayfind.errors`, `wayfind.adapters`, generic `wayfind.query`, semantic search, signposts, or `wayfind.implications`. Those require additional accepted substrates or field evidence before they can answer honestly.

```ts
import { wayfinderTopo } from '@ontrails/wayfinder';
import { surface } from '@ontrails/mcp';

await surface(wayfinderTopo, {
  include: ['wayfind.overview', 'wayfind.search', 'wayfind.describe'],
});
```

Keep included Wayfinder trails behind a host-owned authorization boundary. Wildcard includes such as `['**']` do not expose internal trails.

## Overview

Use `wayfind.overview` to inspect the saved graph shape before asking narrower questions.

```ts
import { createTrailContext } from '@ontrails/core';
import { wayfindOverviewTrail } from '@ontrails/wayfinder';

const result = await wayfindOverviewTrail.blaze(
  { rootDir: process.cwd() },
  createTrailContext()
);
```

The output includes counts for trails, contours, resources, signals, surfaces, facets, versions, and examples, along with the TopoGraph artifact source.

## Typed Filtering

`wayfind.search` and the list trails use the same typed filter kit. Filters are explicit fields, not a query mini-language.

```ts
import { wayfindSearchTrail } from '@ontrails/wayfinder';
import { createTrailContext } from '@ontrails/core';

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

Supported filters include entity kind, exact ID, ID prefix, namespace, intent, surface, facet, versioning, example coverage, resource usage, and signal usage. Use `createWayfinderGraphEntityPredicate` or `filterWayfinderEntityRefs` when matching relationship filters directly in code so facet membership and projected surfaces are evaluated with graph-derived context.

## Describe And Contract

Use `wayfind.describe` when you need the saved topo entity and `wayfind.contract` when you only need the input/output contract shape.

```ts
import {
  wayfindContractTrail,
  wayfindDescribeTrail,
} from '@ontrails/wayfinder';
import { createTrailContext } from '@ontrails/core';

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

Missing IDs return `Result.err(new NotFoundError(...))`, preserving Trails' surface error mapping instead of returning ambiguous empty objects.

## Surfaces, Facets, Versions, And Examples

`wayfind.surfaces` includes both directly projected trail surfaces and facet-projected surfaces. `wayfind.facets` returns facet membership, visibility, and descriptions. `wayfind.versions` returns current and historical trail versions. `wayfind.examples` lists saved examples without executing any trail.

## Nearby, Impact, And Diff

`wayfind.nearby` returns the direct saved graph relationships around one entity. The relation graph is typed and deterministic: resources point to trails that use them, signals point to producing or consuming trails, surfaces and facets point to projected member trails, composed trails point to their composers, and trails point to saved version records.

```ts
import {
  wayfindDiffTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
} from '@ontrails/wayfinder';
import { createTrailContext } from '@ontrails/core';

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

`wayfind.impact` walks those typed relation edges with `downstream`, `upstream`, or `both` direction. `downstream` follows the stored edge direction, which is oriented from contract substrate to affected graph members: resource-to-trail, signal-to-trail, surface-to-trail, facet-to-trail, composed-trail-to-composer, and trail-to-version. `wayfind.diff` compares two saved TopoGraph artifacts with `deriveTopoGraphDiff`; it requires an explicit `againstDir` or `againstRootDir` baseline instead of deriving either graph from live source.

These queries are intentionally graph-read only. They do not provide `wayfind.query`, semantic search, signposts, or implications yet.
