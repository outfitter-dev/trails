# @ontrails/http

## 1.0.0

### Major Changes

- [`5cab237`](https://github.com/outfitter-dev/trails/commit/5cab237bcdb47ba6317953ee42aeee3458d26acb): Restructure HTTP package and fix Codex review findings.

  **http**: BREAKING — the Hono adapter moved to `@ontrails/hono` while `@ontrails/http` owns framework-agnostic route definitions. Hono is now a peer dependency of the adapter. `buildHttpRoutes()` is framework-agnostic. Fixed: malformed JSON → 400, execute() never throws, query parsing preserves raw strings and supports arrays.

  **schema**: OpenAPI 200 response wraps in `{ data }` envelope matching wire format. Always includes 400 ValidationError with error schema. basePath trailing slash normalized.

### Minor Changes

- [`69057e9`](https://github.com/outfitter-dev/trails/commit/69057e9348006b2b70c9f6237572a5aa8de3ee1f): Add hierarchical CLI command trees and structured input, enforce established-only topo exports across surfaces, move developer topo and tracing state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.
- [`ebbf0c5`](https://github.com/outfitter-dev/trails/commit/ebbf0c538550429f92944ac2d196b6bc9ca00c4b): Consolidated improvements across all surface packages.

  **core**: Add `TrailResult<T>` utility type, `topo.ids()` and `topo.count` accessors, `dispatch()` for headless trail execution, and extract shared `executeTrail` pipeline used by CLI/MCP/HTTP.

  **http**: Detect route path collisions and return `Result` from `buildHttpRoutes()`, wire request `AbortSignal` through to trail context, and make write → POST mapping explicit in intent-to-method lookup.

  **mcp**: Return `Result` from `buildMcpTools()` on collision instead of throwing.

  **cli**: Verify exception catching via centralized `executeTrail`.

  **testing**: Follow context awareness improvements.

  **warden**: Refactor rules as composable trails with examples.

  **schema**: Error code and empty body fixes.

- [`5795bd2`](https://github.com/outfitter-dev/trails/commit/5795bd21abe44b0b91650c34981bf61080e4a7a3): HTTP surface and OpenAPI generation.

  **http**: New `@ontrails/http` package — framework-agnostic HTTP route projection. `surface()` derives routes from trail IDs, maps intent to HTTP verbs (read→GET, write→POST, destroy→DELETE), and maps error taxonomy to status codes.

  **trails**: Depend on `@ontrails/http` for `trails survey --openapi`.

- [`2bf239e`](https://github.com/outfitter-dev/trails/commit/2bf239e0ed42f82c3b3789b89db98fb6fe0c017a): Move OpenAPI generation ownership to the HTTP surface.

  **http**: Export `deriveOpenApiSpec()` and its OpenAPI types from `@ontrails/http`.

  **schema**: Remove the OpenAPI helper export so schema stays focused on surface maps, locks, and semantic diffing.

- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.
- [`88a6a62`](https://github.com/outfitter-dev/trails/commit/88a6a62a9e9e230ca6d368fa78dc3ece6c816204): Complete the v1 classification-first cutover from projection/project vocabulary
  to derive/derived for contract-owned fact production and render/rendered for
  surface presentation. Public type, helper, rule, relation, and report names move
  without compatibility aliases; ordinary repository/project nouns remain
  explicit preserves or structured review inventory.
- [`26f9ffd`](https://github.com/outfitter-dev/trails/commit/26f9ffd7f168fc3c45a1a57d5315902f41963a2e): Project typed-layer `input` schemas onto MCP and HTTP surfaces. Closes Phase 7. Lifts `collectAttachedTypedLayers` and `projectLayerFieldName` (collision-rename rule) into `@ontrails/core/internal/layer-projection` so all three surfaces share one source of truth. The CLI surface refactors to consume the lifted helpers (no behavior change). MCP merges layer fields into each tool's `inputSchema` and partitions inbound args at invocation time. HTTP merges layer fields into the route's request schema (query for reads, body for writes) and exposes new optional `HttpRouteDefinition.inputSchema` + `layerInputProjections` for surface adapters / OpenAPI generators. Collision rule matches TRL-473's: deterministic rename to a layer-prefixed camelCase name with the original captured in the routing table. Side fix: MCP and HTTP handlers now forward `topoLayers: graph.layers` + `surfaceLayers: layers` so topo-scope layers actually compose at runtime (previously the handlers used the deprecated `layers` alias and never read `graph.layers`).
- [`c0b2948`](https://github.com/outfitter-dev/trails/commit/c0b29483c289f57ac9b491d8776e29e4335b937f): Add `@ontrails/http/fetch`, a shared Web Fetch request/response kernel for HTTP
  surface materializers.
- [`fc3219c`](https://github.com/outfitter-dev/trails/commit/fc3219c093a1049b9f1b6d8db5ff38632a57ed35): Add `@ontrails/http/bun`, a Bun-native HTTP surface materializer backed by the
  shared Web Fetch kernel.
- [`22c6c06`](https://github.com/outfitter-dev/trails/commit/22c6c06a3b846dab64b78b7ccc27cb1ebd22e402): Accept ADR-0041 Unified Observability and ship the first activation and
  observability primitives it depends on: activation trace records, topo-level
  observe configuration, webhook activation materialization, signal/webhook
  warden coaching, the `@ontrails/observe` package, sink composition, and
  zero-dependency observe sinks.
- [`fde5516`](https://github.com/outfitter-dev/trails/commit/fde5516ad396faa718936b10ff658b3ade3383b9): Trail-native vocabulary cutover. Breaking API field renames across all packages:

  - Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `resources:`, `metadata:` → `meta:`, `emits:` → `fires:`
  - Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.fire()`, `ctx.signal` (abort) → `ctx.abortSignal`
  - Entry points: `trailhead(app)` → `surface(app)`
  - Package rename: `@ontrails/crumbs` / `@ontrails/tracker` → `@ontrails/tracing`
  - Wrapper types: retired gate/middleware vocabulary in favor of `Layer` and `layers`
  - Package taxonomy: retired connector vocabulary in favor of adapters

### Patch Changes

- [`e41c382`](https://github.com/outfitter-dev/trails/commit/e41c3829c2d692683b78c730e67fd5b17ac0ff4e): Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- [`da6e2ca`](https://github.com/outfitter-dev/trails/commit/da6e2caeb06f150042148f10f03a6a9dae5648d1): Cleanup and hardening pass across all packages.

  **core**: Deduplicate `DispatchOptions` as type alias of `ExecuteTrailOptions`. Replace `TrailContext` index signature with typed `extensions` field for type safety. Deep-merge `extensions` in `executeTrail` context resolution. Remove unused surface-map type plus legacy `connectors.ts`, `health.ts`, and `job.ts` proof-of-concept files from the published package.

  **cli**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `surface()` with opt-out via `validate: false`.

  **http**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `surface()` with opt-out.

  **mcp**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `surface()` with opt-out.

  **warden**: Project-aware rule context preserved in trail wrappers.

- [`6944147`](https://github.com/outfitter-dev/trails/commit/694414712949a1107235684a2492ac982ed39a20): Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configResource`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authResource` and `auth.verify` trail for runtime authorization checks
  - **tracing**: Rename tracks to tracing; add `tracingResource` and `tracing.status` trail for structured signal tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for resource and composition updates

- [`1eb5bdc`](https://github.com/outfitter-dev/trails/commit/1eb5bdc06142d8886f3870801b2ef71a0c5f3844): Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.
- [`6300f70`](https://github.com/outfitter-dev/trails/commit/6300f709bb6dffc0e6cc82479fe8d0204c52bbba): Refresh source comments and test labels for retired connector terminology as adapter guardrails become strict.
- [`95bf132`](https://github.com/outfitter-dev/trails/commit/95bf132a15d6bd0f3a9e5fa597697393014f1e21): Wire HTTP permit resolution through the Hono adapter, including request headers for Bearer Authorization handling.
- [`94a8380`](https://github.com/outfitter-dev/trails/commit/94a83801f8bc7a8d30dd0e134a085fdabf74ba50): Add public API examples for the shared Web Fetch route and topo handlers.
- [`94a8380`](https://github.com/outfitter-dev/trails/commit/94a83801f8bc7a8d30dd0e134a085fdabf74ba50): Add a public API example for the HTTP intent method table.
- [`6517f67`](https://github.com/outfitter-dev/trails/commit/6517f67b9dcc9d0ab64b1c7201b5d326905498e4): The OpenAPI projection now documents BlobRef routes as binary responses (`content: { '*/*': { schema: { type: 'string', format: 'binary' } } }`) instead of a JSON data envelope, matching the raw bytes the runtime serves with the blob's declared mimeType. Error responses keep the JSON error envelope. Both the fetch handler and the OpenAPI projection now share one BlobRef output recognition helper.
- [`00f7093`](https://github.com/outfitter-dev/trails/commit/00f7093132a50c49b7bc2dcf9eef98f9424fd2e0): Add resources as a first-class primitive.

  Resources make infrastructure dependencies declarative, injectable, and governable. Define a resource with `resource()`, declare it on a trail with `resources: [db]`, and access it with `db.from(ctx)` or `ctx.resource()`.

  **Core:** `resource()` factory, `ResourceSpec<T>`, `ResourceContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isResource` guard, `findDuplicateResourceId`, topo resource discovery and validation, `resources` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testCrosses`. Explicit `resources` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Resource mock propagation through cross graphs.

  **Warden:** `resource-declarations` rule validates `db.from(ctx)` and `ctx.resource()` usage matches declared `resources: [...]`. `resource-exists` rule validates declared resource IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Surfaces:** Resource overrides thread through the CLI, MCP, and HTTP surfaces.

  **Introspection:** Survey and surface map outputs include resource graph. Topo exposes `.resources`, `.getResource()`, `.hasResource()`, `.listResources()`, `.resourceIds()`, `.resourceCount`.

  **Docs:** ADR-009 accepted. Unified resource guide, updated vocabulary, getting-started, architecture, and package READMEs.

- [`49c2e7d`](https://github.com/outfitter-dev/trails/commit/49c2e7d5c7c063b9aa6abee1d2932bf3003133cc): Refresh published package README taxonomy to use adapter language instead of retired connector vocabulary.
- [`c36aca9`](https://github.com/outfitter-dev/trails/commit/c36aca978c7e1561e68701c084241e5b3f85dcef): Preserve existing Result error boundaries directly and widen Warden pass-through
  coaching beyond trail blazes.
- [`84f56a5`](https://github.com/outfitter-dev/trails/commit/84f56a5b97e9fed3d673e87da8eebdd916390449): Project live trail-version metadata on CLI, HTTP, and MCP surfaces and thread explicit surface version selection into shared trail execution.
- [`ab5c767`](https://github.com/outfitter-dev/trails/commit/ab5c7670446baa89cc10241686d51c16d0215e04): Serve `BlobRef` trail outputs as bytes on HTTP (TRL-1192). When a trail's output schema is `blobRefSchema`, the route handler streams the blob's data with `Content-Type` from its `mimeType` and a `Content-Length` from its `size` — for both `Uint8Array` and `ReadableStream` payloads — instead of wrapping the value in the JSON envelope. Error results keep the JSON error envelope, and non-blob trails are unchanged. Apps no longer need to hand-mount raw-byte routes beside the derived surface.
- [`b9e82a3`](https://github.com/outfitter-dev/trails/commit/b9e82a33546356c93fbc302fb934a83f19f1c2c5): Webhook ingress v2 (TRL-1194, absorbing TRL-1174 and TRL-1175): store-verified, per-endpoint webhook ingress becomes framework-expressible. `webhook()` accepts dynamic path segments (`path: '/hooks/:endpoint'`) whose values are delivered as envelope fields, opt-in `rawBody: true` delivery (a non-JSON body is no longer a surface-level failure — the trail owns payload interpretation), an allowlisted `headers` list delivered lowercased, and `resources` that make `verify` resource-capable: the HTTP surface resolves the declared resources into a context for the verifier and releases them afterwards, so signature checks can reach stores holding per-endpoint secrets. Envelope-mode ingress responds 202 Accepted; classic static webhooks keep their exact-match, JSON-gated, 200 behavior. Core exports `parseWebhookPathParams`, `matchWebhookPath`, `webhookPathPatternsOverlap`, and `createResources`. The `webhook-route-collision` Warden rule now also flags dynamic patterns that overlap other webhook or derived routes, not just exact method/path duplicates.
- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.
- [`bc2d327`](https://github.com/outfitter-dev/trails/commit/bc2d3276cf0af2c7217365a28b436ebf3023c09b): Close HTTP package documentation around the shared `@ontrails/http/fetch` kernel, Bun-native `@ontrails/http/bun` subpath, and Hono adapter boundary before versioning.
- [`5d88104`](https://github.com/outfitter-dev/trails/commit/5d88104c6c269e2ef1e92ba3b9e09a410df10c7b): Polish Trails blaze terminology across package docs and Warden guidance.
- [`fc00aeb`](https://github.com/outfitter-dev/trails/commit/fc00aebf67e968525b53a1719675af3e57586546): Add adapter target conformance metadata and scaffold extracted HTTP adapters through `trails create adapter`.
- [`ab1c77c`](https://github.com/outfitter-dev/trails/commit/ab1c77cddd90c30af28887f2bbd2cf2416900068): Advertise first-party adapter target metadata for catalog derivation.
- [`8ca5b85`](https://github.com/outfitter-dev/trails/commit/8ca5b85d4f05edd3b70e5203fadc9133745cd2bc): Expose owner-owned HTTP adapter conformance cases from `@ontrails/http/testing`.
- [`9c5ecdc`](https://github.com/outfitter-dev/trails/commit/9c5ecdc54b79daf215eb04e2abaa65042cdf4686): Refresh HTTP docs for the stable RC pass so public package guidance uses the
  binding vocabulary and beta install guidance avoids stale copied pin examples.
- [`9bf592d`](https://github.com/outfitter-dev/trails/commit/9bf592ddba46aa12e3f4e6ffc0f772f7a41ed3df): Declare verified first-party adapter metadata for Drizzle, HTTP/Bun, and Store/Jsonfile so shared adapter checks can dogfood real owner targets.
- [`df9a7d0`](https://github.com/outfitter-dev/trails/commit/df9a7d00fe4d9ebec948b6ebed6dc4525fc8e0dc): Add project-aware public export-map governance for @ontrails workspace docs,
  imports, root barrels, and bin-only package surfaces.
- [`61497c5`](https://github.com/outfitter-dev/trails/commit/61497c54deaaae2d067af88d0be6db0a5acb5faf): Add v1-minimum public API examples for shipped surface entrypoints.

## 1.0.0-beta.50

## 1.0.0-beta.49

## 1.0.0-beta.48

## 1.0.0-beta.47

## 1.0.0-beta.46

## 1.0.0-beta.45

## 1.0.0-beta.44

### Patch Changes

- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.

## 1.0.0-beta.43

### Minor Changes

- [`88a6a62`](https://github.com/outfitter-dev/trails/commit/88a6a62a9e9e230ca6d368fa78dc3ece6c816204): Complete the v1 classification-first cutover from projection/project vocabulary
  to derive/derived for contract-owned fact production and render/rendered for
  surface presentation. Public type, helper, rule, relation, and report names move
  without compatibility aliases; ordinary repository/project nouns remain
  explicit preserves or structured review inventory.

## 1.0.0-beta.42

## 1.0.0-beta.41

## 1.0.0-beta.40

### Minor Changes

- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.

### Patch Changes

- [`9bf592d`](https://github.com/outfitter-dev/trails/commit/9bf592ddba46aa12e3f4e6ffc0f772f7a41ed3df): Declare verified first-party adapter metadata for Drizzle, HTTP/Bun, and Store/Jsonfile so shared adapter checks can dogfood real owner targets.

## 1.0.0-beta.39

### Patch Changes

- [`6517f67`](https://github.com/outfitter-dev/trails/commit/6517f67b9dcc9d0ab64b1c7201b5d326905498e4): The OpenAPI projection now documents BlobRef routes as binary responses (`content: { '*/*': { schema: { type: 'string', format: 'binary' } } }`) instead of a JSON data envelope, matching the raw bytes the runtime serves with the blob's declared mimeType. Error responses keep the JSON error envelope. Both the fetch handler and the OpenAPI projection now share one BlobRef output recognition helper.
- [`ab5c767`](https://github.com/outfitter-dev/trails/commit/ab5c7670446baa89cc10241686d51c16d0215e04): Serve `BlobRef` trail outputs as bytes on HTTP (TRL-1192). When a trail's output schema is `blobRefSchema`, the route handler streams the blob's data with `Content-Type` from its `mimeType` and a `Content-Length` from its `size` — for both `Uint8Array` and `ReadableStream` payloads — instead of wrapping the value in the JSON envelope. Error results keep the JSON error envelope, and non-blob trails are unchanged. Apps no longer need to hand-mount raw-byte routes beside the derived surface.
- [`b9e82a3`](https://github.com/outfitter-dev/trails/commit/b9e82a33546356c93fbc302fb934a83f19f1c2c5): Webhook ingress v2 (TRL-1194, absorbing TRL-1174 and TRL-1175): store-verified, per-endpoint webhook ingress becomes framework-expressible. `webhook()` accepts dynamic path segments (`path: '/hooks/:endpoint'`) whose values are delivered as envelope fields, opt-in `rawBody: true` delivery (a non-JSON body is no longer a surface-level failure — the trail owns payload interpretation), an allowlisted `headers` list delivered lowercased, and `resources` that make `verify` resource-capable: the HTTP surface resolves the declared resources into a context for the verifier and releases them afterwards, so signature checks can reach stores holding per-endpoint secrets. Envelope-mode ingress responds 202 Accepted; classic static webhooks keep their exact-match, JSON-gated, 200 behavior. Core exports `parseWebhookPathParams`, `matchWebhookPath`, `webhookPathPatternsOverlap`, and `createResources`. The `webhook-route-collision` Warden rule now also flags dynamic patterns that overlap other webhook or derived routes, not just exact method/path duplicates.

## 1.0.0-beta.38

## 1.0.0-beta.37

## 1.0.0-beta.36

## 1.0.0-beta.35

## 1.0.0-beta.34

## 1.0.0-beta.33

## 1.0.0-beta.32

### Patch Changes

- Updated dependencies [3e5c0fc]
- Updated dependencies [f3c4fef]
- Updated dependencies [cb0a9d8]
- Updated dependencies [21c6dda]
- Updated dependencies [fe72b84]
  - @ontrails/core@1.0.0-beta.32

## 1.0.0-beta.31

### Patch Changes

- Updated dependencies [4cd5d4e]
- Updated dependencies [38907cc]
  - @ontrails/core@1.0.0-beta.31

## 1.0.0-beta.30

### Patch Changes

- @ontrails/core@1.0.0-beta.30

## 1.0.0-beta.29

### Patch Changes

- @ontrails/core@1.0.0-beta.29

## 1.0.0-beta.28

### Patch Changes

- @ontrails/core@1.0.0-beta.28

## 1.0.0-beta.27

### Patch Changes

- @ontrails/core@1.0.0-beta.27

## 1.0.0-beta.26

### Patch Changes

- Updated dependencies [1307568]
- Updated dependencies [371d19e]
  - @ontrails/core@1.0.0-beta.26

## 1.0.0-beta.25

### Patch Changes

- c36aca9: Preserve existing Result error boundaries directly and widen Warden pass-through
  coaching beyond trail blazes.
- Updated dependencies [c36aca9]
- Updated dependencies [3befcf1]
- Updated dependencies [a4f9cf6]
- Updated dependencies [9bcf34e]
  - @ontrails/core@1.0.0-beta.25

## 1.0.0-beta.24

### Patch Changes

- @ontrails/core@1.0.0-beta.24

## 1.0.0-beta.23

### Patch Changes

- 9c5ecdc: Refresh HTTP docs for the stable RC pass so public package guidance uses the
  binding vocabulary and beta install guidance avoids stale copied pin examples.
  - @ontrails/core@1.0.0-beta.23

## 1.0.0-beta.22

### Patch Changes

- @ontrails/core@1.0.0-beta.22

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [99523f2]
  - @ontrails/core@1.0.0-beta.21

## 1.0.0-beta.20

### Patch Changes

- Updated dependencies [851a2a3]
  - @ontrails/core@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

- e41c382: Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- 1eb5bdc: Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.
- 94a8380: Add public API examples for the shared Web Fetch route and topo handlers.
- 94a8380: Add a public API example for the HTTP intent method table.
- 84f56a5: Project live trail-version metadata on CLI, HTTP, and MCP surfaces and thread explicit surface version selection into shared trail execution.
- 5d88104: Polish Trails blaze terminology across package docs and Warden guidance.
- fc00aeb: Add adapter target conformance metadata and scaffold extracted HTTP adapters through `trails create adapter`.
- ab1c77c: Advertise first-party adapter target metadata for catalog derivation.
- 8ca5b85: Expose owner-owned HTTP adapter conformance cases from `@ontrails/http/testing`.
- Updated dependencies [e41c382]
- Updated dependencies [1eb5bdc]
- Updated dependencies [f8d80b9]
- Updated dependencies [846a597]
- Updated dependencies [223aaad]
- Updated dependencies [3125f4d]
- Updated dependencies [2494dc6]
- Updated dependencies [2d53717]
- Updated dependencies [16cb740]
- Updated dependencies [8894ecb]
- Updated dependencies [fdf7ec9]
- Updated dependencies [d76be13]
- Updated dependencies [84f56a5]
- Updated dependencies [431b04c]
- Updated dependencies [5d88104]
- Updated dependencies [f04a9ef]
  - @ontrails/core@1.0.0-beta.19

## 1.0.0-beta.18

### Minor Changes

- c0b2948: Add `@ontrails/http/fetch`, a shared Web Fetch request/response kernel for HTTP
  surface materializers.
- fc3219c: Add `@ontrails/http/bun`, a Bun-native HTTP surface materializer backed by the
  shared Web Fetch kernel.

### Patch Changes

- bc2d327: Close HTTP package documentation around the shared `@ontrails/http/fetch` kernel, Bun-native `@ontrails/http/bun` subpath, and Hono adapter boundary before versioning.
  - @ontrails/core@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- 61497c5: Add v1-minimum public API examples for shipped surface entrypoints.
- Updated dependencies [3dc8254]
  - @ontrails/core@1.0.0-beta.17

## 1.0.0-beta.16

### Minor Changes

- 2bf239e: Move OpenAPI generation ownership to the HTTP surface.

  **http**: Export `deriveOpenApiSpec()` and its OpenAPI types from `@ontrails/http`.

  **schema**: Remove the OpenAPI helper export so schema stays focused on surface maps, locks, and semantic diffing.

- 26f9ffd: Project typed-layer `input` schemas onto MCP and HTTP surfaces. Closes Phase 7. Lifts `collectAttachedTypedLayers` and `projectLayerFieldName` (collision-rename rule) into `@ontrails/core/internal/layer-projection` so all three surfaces share one source of truth. The CLI surface refactors to consume the lifted helpers (no behavior change). MCP merges layer fields into each tool's `inputSchema` and partitions inbound args at invocation time. HTTP merges layer fields into the route's request schema (query for reads, body for writes) and exposes new optional `HttpRouteDefinition.inputSchema` + `layerInputProjections` for surface adapters / OpenAPI generators. Collision rule matches TRL-473's: deterministic rename to a layer-prefixed camelCase name with the original captured in the routing table. Side fix: MCP and HTTP handlers now forward `topoLayers: graph.layers` + `surfaceLayers: layers` so topo-scope layers actually compose at runtime (previously the handlers used the deprecated `layers` alias and never read `graph.layers`).
- 22c6c06: Accept ADR-0041 Unified Observability and ship the first activation and
  observability primitives it depends on: activation trace records, topo-level
  observe configuration, webhook activation materialization, signal/webhook
  warden coaching, the `@ontrails/observe` package, sink composition, and
  zero-dependency observe sinks.

### Patch Changes

- 6300f70: Refresh source comments and test labels for retired connector terminology as adapter guardrails become strict.
- 95bf132: Wire HTTP permit resolution through the Hono adapter, including request headers for Bearer Authorization handling.
- 49c2e7d: Refresh published package README taxonomy to use adapter language instead of retired connector vocabulary.
- df9a7d0: Add project-aware public export-map governance for @ontrails workspace docs,
  imports, root barrels, and bin-only package surfaces.
- Updated dependencies [73622ae]
- Updated dependencies [6300f70]
- Updated dependencies [d172013]
- Updated dependencies [c3fc5c3]
- Updated dependencies [20d7a5c]
- Updated dependencies [be5fb46]
- Updated dependencies [e898cc4]
- Updated dependencies [3395234]
- Updated dependencies [bcdc484]
- Updated dependencies [331e3a9]
- Updated dependencies [4399fdb]
- Updated dependencies [4b8d13b]
- Updated dependencies [112b9f2]
- Updated dependencies [893025e]
- Updated dependencies [eec5e9d]
- Updated dependencies [ebd4434]
- Updated dependencies [863d473]
- Updated dependencies [344f2f7]
- Updated dependencies [26f9ffd]
- Updated dependencies [10eae9a]
- Updated dependencies [22c6c06]
  - @ontrails/core@1.0.0-beta.16

## 1.0.0-beta.15

### Patch Changes

- Updated dependencies [4ad6b25]
  - @ontrails/core@1.0.0-beta.15

## 1.0.0-beta.14

### Minor Changes

- 69057e9: Add hierarchical CLI command trees and structured input, enforce established-only topo exports across trailheads, move developer topo and tracker state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.

### Patch Changes

- Updated dependencies [69057e9]
  - @ontrails/core@1.0.0-beta.14

## 1.0.0-beta.13

### Minor Changes

- Trail-native vocabulary cutover. Breaking API field renames across all packages:

  - Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `provisions:`, `metadata:` → `meta:`, `emits:` → `signals:`
  - Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.signal()`, `ctx.signal` (abort) → `ctx.abortSignal`
  - Entry points: `blaze(app)` → `trailhead(app)`
  - Package rename: `@ontrails/crumbs` → `@ontrails/tracker`
  - Wrapper types: `Layer` → `Gate`, `layers`/`middleware` → `gates`
  - Transport: `surface` → `trailhead`, `adapter` → `connector`

### Patch Changes

- 6944147: Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configProvision`, `configGate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authService` and `auth.verify` trail for runtime authorization checks
  - **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured signal tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for provision and composition updates

- Updated dependencies [6944147]
- Updated dependencies
  - @ontrails/core@1.0.0-beta.13

## 1.0.0-beta.12

### Patch Changes

- Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configProvision`, `config.gate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authProvision` and `auth.verify` trail for runtime authorization checks
  - **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured event tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for provision and composition updates

- Updated dependencies
  - @ontrails/core@1.0.0-beta.12

## 1.0.0-beta.11

### Patch Changes

- Add provisions as a first-class primitive.

  Provisions make infrastructure dependencies declarative, injectable, and governable. Define a provision with `provision()`, declare it on a trail with `provisions: [db]`, and access it with `db.from(ctx)` or `ctx.provision()`.

  **Core:** `provision()` factory, `ProvisionSpec<T>`, `ProvisionContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isProvision` guard, `findDuplicateProvisionId`, topo provision discovery and validation, `provisions` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testCrosses`. Explicit `provisions` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Provision mock propagation through crossing graphs.

  **Warden:** `provision-declarations` rule validates `db.from(ctx)` and `ctx.provision()` usage matches declared `provisions: [...]`. `provision-exists` rule validates declared provision IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Trailheads:** Provision overrides thread through `run` and `trailhead` on CLI, MCP, and HTTP.

  **Introspection:** Survey and trailhead map outputs include provision graph. Topo exposes `.provisions`, `.getProvision()`, `.hasProvision()`, `.listProvisions()`, `.provisionIds()`, `.provisionCount`.

  **Docs:** ADR-009 accepted. Unified provisions guide, updated vocabulary, getting-started, architecture, and package READMEs.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.11

## 1.0.0-beta.10

### Patch Changes

- Cleanup and hardening pass across all packages.

  **core**: Deduplicate `DispatchOptions` as type alias of `ExecuteTrailOptions`. Replace `TrailContext` index signature with typed `extensions` field for type safety. Deep-merge `extensions` in `executeTrail` context resolution. Remove unused `Trailhead` type, `connectors.ts`, `health.ts`, and `job.ts` proof-of-concept from published package.

  **cli**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out via `validate: false`.

  **http**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out.

  **mcp**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out.

  **warden**: Project-aware rule context preserved in trail wrappers.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.10

## 1.0.0-beta.9

### Minor Changes

- Consolidated improvements across all trailhead packages.

  **core**: Add `TrailResult<T>` utility type, `topo.ids()` and `topo.count` accessors, `run()` for headless trail execution, and extract shared `executeTrail` pipeline used by CLI/MCP/HTTP.

  **http**: Detect route path collisions and return `Result` from `buildHttpRoutes()`, wire request `AbortSignal` through to trail context, and make write → POST mapping explicit in intent-to-method lookup.

  **mcp**: Return `Result` from `buildMcpTools()` on collision instead of throwing.

  **cli**: Verify exception catching via centralized `executeTrail`.

  **testing**: Cross-context awareness improvements.

  **warden**: Refactor rules as composable trails with examples.

  **schema**: Error code and empty body fixes.

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.9

## 1.0.0-beta.8

### Major Changes

- Restructure HTTP package and fix Codex review findings.

  **http**: BREAKING — `trailhead()` moved to `@ontrails/http/hono` subpath. Hono is now a peer dependency. `buildHttpRoutes()` is framework-agnostic. Fixed: malformed JSON → 400, execute() never throws, query parsing preserves raw strings and supports arrays.

  **schema**: OpenAPI 200 response wraps in `{ data }` envelope matching wire format. Always includes 400 ValidationError with error schema. basePath trailing slash normalized.

### Patch Changes

- @ontrails/core@1.0.0-beta.8

## 1.0.0-beta.7

### Minor Changes

- HTTP trailhead and OpenAPI generation.

  **http**: New `@ontrails/http` package — Hono-based HTTP connector. `trailhead()` derives routes from trail IDs, maps intent to HTTP verbs (read→GET, write→POST, destroy→DELETE), and maps error taxonomy to status codes. Returns the Hono instance.

  **schema**: Add `generateOpenApiSpec(topo)` — generates a complete OpenAPI 3.1 spec from the topo. Each trail becomes an operation with path, method, schemas, and error responses derived from the contract.

  **trails**: `trails survey --openapi` outputs the OpenAPI spec for any Trails app.

### Patch Changes

- @ontrails/core@1.0.0-beta.7
