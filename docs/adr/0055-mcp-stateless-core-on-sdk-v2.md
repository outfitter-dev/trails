---
id: 55
slug: mcp-stateless-core-on-sdk-v2
title: MCP Targets the Stateless Core on SDK v2
status: accepted
created: 2026-10-28
updated: 2026-10-28
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 5, 6, 26, 35, 47, 50, 52]
---

# ADR-0055: MCP Targets the Stateless Core on SDK v2

## Context

Trails' MCP surface renders the same trail contracts as CLI and HTTP, but its current entry point only opens stdio. At baseline `34d7f6e14`, `packages/mcp/package.json` declares Trails version `0.2.5` and the SDK v1 peer `@modelcontextprotocol/sdk ^1.28.0`. `surface()` in `packages/mcp/src/surface.ts` creates a server and connects stdio. The implementation already runs tools through Trails' execution pipeline; the protocol integration is the part that must change.

The MCP revision dated 2026-07-28 makes requests self-contained. The official SDK v2 implements that revision; npm records `@modelcontextprotocol/server` `2.4.0` published on October 23, 2026.[^sdk][^registry] Earlier planning described Trails `0.2.4` and Zod `4.3.6`. The inspected baseline is `0.2.5`, with Zod `4.6.7` resolved in `bun.lock`. It already satisfies the SDK's Zod 4 requirement; this migration does not need a Zod 3 compatibility layer.[^upgrade]

This decision records Matt's October 27 choices in [TRL-1437]: move to SDK v2 as a documented break and own the portable MCP HTTP rendering. It also carries the migration assessment formerly assigned to [TRL-1337]. Accepting a target architecture does not claim that the baseline already implements it.

## Decision

### SDK v2 carries both protocol eras

`@ontrails/mcp` moves to the official `@modelcontextprotocol/server` 2.x SDK. The package change ships as a documented 0.x minor break under [ADR-0047](0047-stable-release-line-discipline.md#stable-uses-latest-prereleases-use-explicit-channels). There is no additive Trails v1 subpath or parallel v1 package API. A temporary migration skill in the `trails` adopter plugin explains the peer-package change, removed session options, and any changed custom MCP-resource shape. Retire that skill with the following release after the migration release.

Package migration and protocol migration are distinct. SDK v2 still permits legacy-only entry points. Trails must move its entry points to the SDK's `serveStdio` and `createMcpHandler` APIs to serve the modern revision.[^upgrade] The public `surface(graph)` remains the stdio one-liner specified by [ADR-0035](0035-surface-apis-render-the-graph.md#surface-is-the-boundary-owned-one-liner). SDK details stay behind Trails' surface API.

The compatibility window supports modern `2026-07-28` and a legacy stateless HTTP lane for 2025 clients. This is protocol compatibility inside SDK v2, independent of the package break. The SDK handler's default `legacy: 'stateless'` mode is the implementation starting point. Stdio uses the SDK's dual-era entry. Do not restore protocol sessions to make the HTTP lane look like the old API. Legacy stateless HTTP cannot fulfill interactive server-to-client requests; it must refuse unsupported interactions honestly.[^modern]

### Requests replace protocol sessions

The migration assessment is part of this decision:

| Earlier protocol behavior | Modern rendering requirement |
| --- | --- |
| `initialize` and `notifications/initialized` handshake | Version and client capabilities travel in each request's `_meta`; implement `server/discover`. |
| `Mcp-Session-Id` and connection-scoped protocol state | Resolve each request independently; use explicit handles for application state. |
| HTTP GET notification stream | Use opted-in `subscriptions/listen` POST responses when that capability is implemented. |
| SSE event IDs and `Last-Event-ID` resumability | Do not promise response-stream resumption or automatic redelivery. |
| `ping` and `logging/setLevel` | Remove those protocol methods. |
| Server-initiated JSON-RPC requests | Render additional-input exchanges through Multi Round-Trip Requests (MRTR). |

The protocol changelog establishes these removals and replacements.[^changes] MRTR returns `resultType: 'input_required'`; a client retries the original request with input responses. Ordinary modern results carry `resultType: 'complete'`. Request-scoped progress remains request-scoped.[^changes] Supporting the modern core does not advertise subscriptions, elicitation, tasks, or Events before their own implementations and acceptance gates are satisfied.

The baseline tool path exposes a concrete session seam: `surface.ts` reads `authInfo.sessionId` and forwards it to the tool adapter; `build.ts` exposes `sessionId` in the permit-resolution context. Remove that seam rather than preserving a synthetic modern session. The current registrations for tool listing/calls and resource listing/reads must move to the new SDK context and result shapes. The Trails stdio adapter also needs the dual-era entry point; changing import names alone does not establish protocol support.

### Trails owns a portable fetch-shaped MCP handler

`@ontrails/mcp` owns a Web-standard `Request` to `Response` handler built on SDK v2's `createMcpHandler`. It has no Node-only imports and no dependency on the `agents` package. Bun and Hono mount it using the same separation of contract rendering and hosting as [ADR-0005](0005-framework-agnostic-http-route-model.md#decision). Cloudflare's adapter mounts that handler through `createWorkersHandler`; it does not invent a second MCP protocol implementation. The SDK documents this fetch-shaped path for Web-standard runtimes.[^web]

Modern HTTP uses POST requests with the required `Mcp-Method` and, where applicable, `Mcp-Name` headers. The wrapper validates Origin and rejects an invalid present Origin with 403. It provides the required host boundary protections; `createMcpHandler` does not install Host or Origin validation automatically. There is no modern GET stream or `Last-Event-ID` replay contract.[^http][^upgrade] Request-scoped SSE replies remain available: excluding the obsolete HTTP+SSE protocol does not exclude Streamable HTTP's response framing.

Tool execution still uses the shared pipeline from [ADR-0006](0006-shared-execution-pipeline.md#decision). Trail implementations receive surface-agnostic context and return `Result`. Core owns taxonomy facts under [ADR-0026](0026-error-taxonomy-as-transport-independent-behavior-contract.md#decision). MCP renders trail failures as tool results and reserves JSON-RPC errors for protocol failures; the shared error-table and MCP result-contract issues own the concrete mapping changes.

### Authorization is resolved for every request

The MCP handler exposes bearer credentials and per-request `_meta` context to `resolvePermit`. Neither a connection nor a former session ID grants authority. Protocol metadata supplies request context; it is not trusted proof of identity. Resource reads and permit-filtered discovery follow the same request-level boundary as tool calls. The protocol permits discovery to vary with the request's authorization, rather than with connection state.[^resources]

The Auth lane owns credential verification, OAuth resource-server policy, RFC 9728 metadata, and challenge formatting. This ADR guarantees the context seam that rendering consumes; it does not create a second OAuth implementation. Stdio remains outside OAuth. Existing permit enforcement and resource-read acceptance must survive the SDK transition.

### Application state has an explicit handle

A trail that creates state returns its handle in its output schema. A later trail takes that handle through its input schema and checks the caller's permit. The handle identifies application state; it does not replace authorization. For example, an export-start trail returns an `exportId`, and export-status takes `exportId` as input. The same contracts work through CLI, HTTP, MCP, or library calls. This follows the protocol's explicit-handle state model.[^state]

The later MCP tasks design note shares this handle grammar. It does not introduce hidden session affinity into trail context. Surface accommodations continue to preserve selected trail identity under [ADR-0050](0050-surface-accommodations-preserve-trail-identity.md#core-rule).

### Cache freshness and audience are separate facts

Derive `ttlMs` from the immutability of the lock-backed facts being served. Mutable or unproven-fresh responses cannot inherit a long lifetime merely because a lock exists. Derive `cacheScope` independently from authorization:

- Use `private` whenever the app has an auth hook, a permit-filtered tool list, or per-subject resources.
- Use `public` only when there is no auth hook and no authorization-dependent result. An immutable response can still be private.

These are Trails' derivation rules for the protocol's caching fields.[^changes] [TRL-1463] owns their implementation. [TRL-1424] is the lock-v6 design input; new persisted cache facts use the overlay mechanism from [ADR-0052](0052-overlays-one-extension-mechanism.md#decision), preserving the campaign's lock-v6 gate before new overlay namespaces. Runtime trail execution continues to resolve from the in-memory topo, not from the lock.

### Deprecated capabilities stay outside this surface

Trails does not expose Roots, Sampling, protocol Logging, legacy HTTP+SSE, Dynamic Client Registration (DCR), or `includeContext` as MCP capabilities. This is Trails' supported capability policy, not a claim that every item has vanished from every upstream compatibility API. Progress notifications remain supported. Auth resource-server behavior does not turn Trails into an OAuth registration server. Later skill guidance uses its own accepted decision under [TRL-1338], keeping `skill://` distinct from the `trails://` graph grammar.

## Consequences

The same authored trail contract gains a portable MCP HTTP rendering while stdio retains its one-line entry. Per-request authorization removes the session seam that would otherwise couple trail execution to a particular host.

The package break requires adopter migration and regression tests, even though both protocol eras remain reachable. SDK v1's upstream support window is not a Trails compatibility promise; upstream states at least six months of fixes after its July 27, 2026 v2 release.[^support] The stateless legacy lane also has less interactive capability than a sessionful legacy host.

This ADR is documentation only (`release:none`). [TRL-1337] owns the SDK migration, its package changeset, stdio regression coverage, and updated guides/examples. [TRL-1340] owns the portable handler and Bun/Hono mounts, HTTP documentation, Wayfinder dogfood, and client reachability proof on both eras. Auth owns its challenge gate; Cloudflare owns the Workers mount. The migration skill is a required companion deliverable. No implementation, publication, deployment, or client interoperability is claimed by accepting this ADR.

## Open questions and implementation gates

- **ChatGPT ordinary-plugin protocol era:** not verified here. Establish whether ordinary plugins use `2026-07-28` or whether that support is limited to Events. Keep the legacy lane usable until client evidence establishes what is needed; do not infer ordinary-plugin support from Events documentation.
- **Blob content against the SDK schema:** not verified here. The baseline `blobToContent` in `packages/mcp/src/build.ts` emits a non-image `{ type: 'resource', uri, mimeType }` shape. Existing tests assert that local shape; they do not prove acceptance by the SDK's tool-result schema. Add the SDK-schema validation at migration and correct the rendering there if needed.
- **Acceptance alignment:** [TRL-1337], [TRL-1340], and [TRL-1338] must reference this decision without turning dependency installation into protocol proof. Durable subscriptions and their replay model retain their separate gates; the SDK's in-process notification bus is not that durable model.

## References

- [TRL-1437] — governing issue and recorded product decisions.
- [ADR-0000](0000-core-premise.md#decision) — one trail contract across peer surfaces.
- [ADR-0005](0005-framework-agnostic-http-route-model.md#decision) — host-independent HTTP rendering.
- [ADR-0006](0006-shared-execution-pipeline.md#decision) — one execution pipeline.
- [ADR-0026](0026-error-taxonomy-as-transport-independent-behavior-contract.md#decision) — shared error behavior.
- [ADR-0035](0035-surface-apis-render-the-graph.md#decision) — derive, create, and surface ownership.
- [ADR-0047](0047-stable-release-line-discipline.md#decision) — release-line discipline.
- [ADR-0050](0050-surface-accommodations-preserve-trail-identity.md#decision) — preserve trail identity.
- [ADR-0052](0052-overlays-one-extension-mechanism.md#decision) — one lock extension mechanism.

[TRL-1437]: https://linear.app/outfitter/issue/TRL-1437
[TRL-1337]: https://linear.app/outfitter/issue/TRL-1337
[TRL-1340]: https://linear.app/outfitter/issue/TRL-1340
[TRL-1338]: https://linear.app/outfitter/issue/TRL-1338
[TRL-1424]: https://linear.app/outfitter/issue/TRL-1424
[TRL-1463]: https://linear.app/outfitter/issue/TRL-1463

[^sdk]: [Official SDK v2 documentation](https://ts.sdk.modelcontextprotocol.io/v2/), inspected October 28, 2026: stable v2 implements revision 2026-07-28.
[^registry]: [npm registry package metadata](https://registry.npmjs.org/@modelcontextprotocol/server), inspected October 28, 2026: version 2.4.0 and its publication timestamp.
[^upgrade]: [SDK v1-to-v2 migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html): entry-point changes, Zod 4 support, and explicit Host/Origin protection.
[^modern]: [SDK modern-protocol support](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html): dual-era entries and the stateless legacy HTTP interaction limit.
[^changes]: [MCP 2026-07-28 changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog): removed protocol state, modern request/result model, explicit handles, and caching fields.
[^web]: [SDK Web-standard serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard.html): portable fetch-shaped HTTP entry.
[^http]: [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http): request headers, Origin validation, and response framing.
[^resources]: [MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources): authorization-dependent discovery is per request.
[^support]: [Official SDK repository](https://github.com/modelcontextprotocol/typescript-sdk): v1 maintenance policy; not a Trails release guarantee.

[^state]: [SEP-2567: Sessionless MCP via Explicit State Handles](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2567): server-minted application handles replace implicit protocol-session state.
