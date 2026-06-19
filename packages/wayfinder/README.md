# @ontrails/wayfinder

Agent-shaped wayfinding query trails over saved graph and package evidence.

`@ontrails/wayfinder` lets agents query a Trails app's resolved topo, source outline, and package-level authoring facts without re-deriving the graph from `grep` plus file reads. The v0 catalog is cold and deterministic: graph queries read existing Topographer artifacts (`topo.lock`, `trails.lock`, and materialized current `trails.db` topo-store records), source outline queries parse explicit files with OXC, and adapter queries read `@ontrails/adapter-kit` package and conformance evidence. Wayfinder does not start apps, boot resources, reach the network, or mutate local state.

The package exports `wayfinderTopo` plus individual graph-read trails.

## V0 Catalog

| Trail | Purpose |
| --- | --- |
| `wayfind.overview` | Summarize saved graph counts, artifact source, freshness, and drift. |
| `wayfind.search` | Find graph entities with typed filters. |
| `wayfind.trails` | List trail summaries with the shared typed filter kit. |
| `wayfind.contours` | List contour summaries with the shared typed filter kit. |
| `wayfind.resources` | List resource summaries and declaring trails. |
| `wayfind.signals` | List signal summaries, producers, and consumers. |
| `wayfind.surfaces` | List saved surface membership facts. |
| `wayfind.facets` | List resolved surface facet metadata and members. |
| `wayfind.versions` | List current and historical trail version records. |
| `wayfind.examples` | List saved examples without executing trails. |
| `wayfind.errors` | List saved trail error facts with provenance and completeness. |
| `wayfind.adapters` | List adapter target and conformance facts with provenance. |
| `wayfind.describe` | Inspect the saved entity record for one ID. |
| `wayfind.contract` | Inspect the input/output/intent contract for one trail or version. |
| `wayfind.nearby` | Return direct typed relation edges around one entity. |
| `wayfind.impact` | Walk upstream, downstream, or both relation directions. |
| `wayfind.outline` | Outline one source file and connect it to saved graph facts when available. |
| `wayfind.diff` | Compare two explicit saved TopoGraph baselines. |

Each graph-read trail is internal by default and returns provenance, freshness, and drift metadata with its result so callers can tell whether the answer came from aligned artifacts, drifted artifacts, absent artifacts, or schema-version drift. `freshness` remains for compatibility; `drift` is the navigation-facing governance signal. Adapter facts carry package and conformance provenance instead. Public surface exposure must be a deliberate host decision.

The v0 catalog intentionally does not include generic `wayfind.query`, semantic search, signposts, or `wayfind.implications`. Those require additional accepted substrates or field evidence before they can answer honestly.

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

Example coverage filters are evaluated against the entity being returned. `wayfind.examples` widens parent trail matches to include current examples plus historical version examples, exact historical-version matches return only that version's examples, and exact current-version matches return the current entry examples. `exampleCoverage: false` is intentionally not widened into covered historical version examples.

## Error Facts

Use `wayfind.errors` when you need to inspect saved error facts for one trail or a filtered set of trails. The query reports documented error examples, handled detours, and later supplied inferred or observed facts with provenance and completeness metadata.

The error facts are deliberately not an exhaustive emitted-error contract. A trail with no error facts still reports unknown emitted-error completeness rather than implying the trail cannot fail, and dynamic-category errors such as `RetryExhaustedError` do not receive fixed surface codes without wrapped-cause evidence.

## Adapter Facts

Use `wayfind.adapters` when you need to inspect adapter targets and adapter-package evidence. The query reads the `@ontrails/adapter-kit` readiness report and distinguishes available owner targets, configured adapter packages, and conformance-backed usage facts.

Runtime observations are not inferred from package metadata. `observed` remains part of the fact vocabulary, but the current query reports zero observed facts until a future runtime evidence source supplies them.

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

## Outline

Use `wayfind.outline` when an agent needs to inspect a file's shape before reading the whole source. The query parses the explicit file path, returns imports, exports, declarations, app/topo declarations, and authored trail IDs, then reconciles trail IDs with saved Topographer artifacts when they are available. Missing artifacts are diagnostics, not hard failures, so `outline` remains useful in a fresh checkout or during repair work.

```ts
import { createTrailContext } from '@ontrails/core';
import { wayfindOutlineTrail } from '@ontrails/wayfinder';

await wayfindOutlineTrail.blaze(
  { file: 'apps/trails/src/app.ts', rootDir: process.cwd(), review: true },
  createTrailContext()
);
```

CLI hosts can expose the same trail as `trails wayfind outline <file>`. Use `--review`, `--source`, `--contracts`, `--surfaces`, or `--all` for blessed views, or `--features source,trails,apps,diagnostics` for an exact feature set. JSON output includes structured counts plus the selected feature list and omitted feature list so agents can distinguish "not requested" from "absent." CLI text output is rendered by the CLI surface from the structured result; the Wayfinder contract does not carry presentation prose.

In text mode, the `--review` view keeps the source map compact while showing graph-backed trail facts when they are available:

```text
apps/trails/src/trails/compile.ts
  trails: 1
  apps: 0
  declarations: 4
  graph matches: 1

  13: const compileCurrentTopo
  24: const compileTrailInputSchema
  33: type CompileTrailInput
  35: const compileTrail

  35: trail compile (write, input+output, 1 example)
```

When saved graph artifacts are missing, `outline` still renders source facts and emits an actionable diagnostic with the compile command shape, including the app module, root directory, and required `topo:write` permit scope. That diagnostic is a prompt to refresh graph evidence; it is not required for source-only navigation.

## Surfaces, Facets, Versions, And Examples

`wayfind.surfaces` includes both directly projected trail surfaces and facet-projected surfaces. `wayfind.facets` returns facet membership, visibility, and descriptions. `wayfind.versions` returns current and historical trail versions sorted by trail ID and numeric version. `wayfind.examples` lists saved examples without executing any trail.

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
