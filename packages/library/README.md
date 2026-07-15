# @ontrails/library

Render a Trails topo as an idiomatic TypeScript library.

`@ontrails/library` is a peer surface for plain TypeScript consumers. It reads the same contract that CLI, MCP, and HTTP read, then renders that graph into function calls, package-facing errors, schema exports, and generated package files.

The package is publishable as the runtime dependency for generated Trails libraries. Generated packages can depend on it while keeping their consumer-facing API idiomatic and package-local.

## API

```ts
import { compile, deriveLibraryApi, surface } from '@ontrails/library';

const renderingPlan = deriveLibraryApi(app);
const client = await surface(app);
const files = compile(app, {
  appExportName: 'app',
  appImportPath: '@acme/app',
  packageName: '@acme/generated',
});
```

- `deriveLibraryApi(graph, options)` is the pure derivation. It returns the rendering plan that decides which public trails become library exports, how export names are derived, which trails are excluded, and where export-name collisions exist.
- `surface(graph, options)` returns an in-memory callable client. The root call lane unwraps `Result.ok` into a return value and maps `Result.err` into typed `LibraryError` subclasses.
- `compile(graph, options)` returns a stable file plan for a generated package. Writing those files is intentionally a thin apply step outside the compiler.

## Generated package shape

Generated packages use one package with subpath exports:

```text
.          consumer-fluent root functions and createX factories
./result   no-throw Result-returning functions
./schemas  authored Zod schemas and optional schema-owned type aliases
./trails   the Trails-native topo entrypoint
```

Stateless trails render to root named exports. Resource-bearing trails render behind a generated `createX(options)` factory so callers can provide resource configuration once and call several related methods from the same client.

Generated root and `/result` subpaths share one internal client module, so importing both subpaths does not open separate root library surfaces.

## Typed signatures

Topo artifacts carry durable contract facts, but they do not preserve erased source-level TypeScript generics. Generated packages therefore stay honest by defaulting method signatures to `unknown` unless the caller binds a rendered trail id to the source trail export that owns its schema types:

```ts
const files = compile(app, {
  appExportName: 'app',
  appImportPath: '../fixture-app',
  packageName: '@acme/generated',
  trailTypeExports: {
    'widget.ping': 'pingTrail',
  },
  typeImportPath: '../fixture-trails',
});
```

With that binding, `/schemas` emits aliases such as `WidgetPingInput = TrailInput<typeof pingTrail>` and the root and `/result` subpaths use those aliases in their public signatures.

Typed layer inputs are rendered into the same public method input object as trail fields. When a layer field collides with a trail field or reserved surface name, the generated library input uses the same deterministic `<layerName><Field>` rename rule as other object-shaped surfaces. Runtime calls validate the rendered input, strip layer-owned fields before trail validation, and route them to the layer's own input slot. When a source trail type binding is provided, generated signatures widen layer-rendered inputs with `Record<string, unknown>` until layer input type exports have a source-level owner.

## Errors

The root API throws package-facing `LibraryError` subclasses. This is a surface mapping, not an implementation behavior change: implementations still return `Result`.

The `/result` subpath preserves the no-throw envelope:

```ts
import { widgetPing } from '@acme/generated/result';

const result = await widgetPing(input);
```

The mapper is built with the shared Trails error taxonomy, so new categories must be covered before the package can typecheck.

## Governance and dogfood

Library-derived facts are embedded in `TopoGraph.library` by Topography. Warden's `library-render-coherence` rule checks that serialized rendering facts do not drift from the graph, including missing target trails and export name collisions.

Run the focused package checks while changing the surface:

```bash
bun run library:smoke
bun run library:dogfood:warden
```

`library:dogfood:warden` compiles the Warden topo into a generated package, typechecks that generated package, runs a generated consumer test through root, `/result`, `/schemas`, and `/trails`, then dry-run packs it.
