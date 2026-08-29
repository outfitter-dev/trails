---
slug: wayfinder-mcp-graph-as-resources
title: Addressable Facts, Dynamic Queries
status: draft
created: 2026-08-29
updated: 2026-08-29
owners: ['[galligan](https://github.com/galligan)']
depends_on: [27, 35, 42, 50, 52, 'wayfinding']
description: "Settles how Wayfinder renders to MCP: stable graph identities become addressable MCP resources under a `trails://{kind}/{id}` grammar, dynamic navigation — free-text query, structured filters, relational walks, map, and diff — stays in tools, and both render from the one resolver/filter/view model already shared with the CLI."
references:
  - docs/adr/drafts/20260503-wayfinding.md
  - docs/adr/0027-visibility-and-filtering.md
  - docs/adr/0035-surface-apis-render-the-graph.md
  - docs/adr/0042-core-topography-boundary-doctrine.md
  - docs/adr/0050-surface-accommodations-preserve-trail-identity.md
  - docs/adr/0052-overlays-one-extension-mechanism.md
linear:
  - TRL-1035
  - TRL-1139
impl_status: planned
---

# ADR: Addressable Facts, Dynamic Queries

## Context

### Wayfinder's MCP rendering predates its navigation model

The Wayfinding draft settled a navigation algebra — a resolver chooses the population, filters narrow it, a view renders it.[^wayfinding] The operator CLI has since converged on that algebra. `apps/trails/src/trails/wayfind.ts:1017-1021` defines one public entry trail whose input schema carries the resolver, the population filters, the view flags, and the `--source` axis:

```ts
export const wayfindTrail = trail('wayfind.navigate', {
  args: ['target'],
  cli: {
    path: 'wayfind',
  },
```

 Explicit selectors are separate internal trails that compose back into it: `wayfind.pattern` (`wayfind.ts:1230`), `wayfind.query` (`wayfind.ts:1260`), and `wayfind.file` (`wayfind.ts:1290`) each declare `composes: ['wayfind.navigate']` and `visibility: 'internal'`.

MCP did not follow. `apps/trails/src/mcp-options.ts:49-58` exposes ten catalog queries directly, one tool apiece:

```ts
  'wayfind.adapters',
  'wayfind.contract',
  'wayfind.diff',
  'wayfind.errors',
  'wayfind.examples',
  'wayfind.impact',
  'wayfind.nearby',
  'wayfind.overview',
  'wayfind.search',
  'wayfind.trails',
] as const;
```

`wayfind.navigate` is not in that list. The CLI reaches the graph through one grammar; MCP reaches it through ten flattened views of the same underlying catalog in `packages/topography/src/wayfind/queries.ts`. That is the drift this ADR closes.

### The façade-tool instinct, and why it was only half right

The older instinct was to collapse Wayfinder into one MCP façade tool. The concern behind it was real and remains real: too many overloaded tools produce poor descriptions, and MCP tool descriptions are the only thing most clients read before choosing. The Wayfinding draft already named the failure on both sides — "the full catalog rendered naively to MCP may be too many tools, while one catch-all tool becomes a junk drawer."[^wayfinding-risk]

What the façade instinct missed is that half of what Wayfinder returns is not a query at all. Asking for `wayfind.contract` on a known trail ID is not a search. It is a fetch against a stable identity the graph already assigns. MCP has a first-class shape for that, and Trails was not using it for graph facts.

### Resources ship today, but the graph is barely in them

`@ontrails/mcp` already implements MCP Resources. `packages/mcp/src/surface.ts:87-98` advertises the capability conditionally:

```ts
      capabilities: {
        ...(mcpResources === undefined ? {} : { resources: {} }),
        tools: {},
      },
```

Three families exist, all `application/json` (`packages/mcp/src/resources.ts:24`, `:36`, `:48`): `trails://surface-map`, `trails://examples/{trailId}`, and `trails://trail/{trailId}`. The first two default on; the graph-facts family defaults off (`resources.ts:290`, `:305`, `:312`). The operator app turns all three on (`mcp-options.ts:85`).

Three properties of that implementation matter for this decision:

- **The resource population is already scoped to the tool population.** `resources.ts:136-144` derives `exposedTrailIds` from the rendered tools, and both `buildExampleResources` and `buildTrailGraphResources` filter the graph by that set. Resources cannot currently be wider than what MCP already renders as tools.
- **There are no URI templates.** Everything is eagerly enumerated into `resources/list`. A repository-wide search for `resourceTemplates`, `resources/templates`, and `ListResourceTemplates` returns nothing. The MCP method that advertises parameterized URIs is unimplemented.[^mcp-spec]
- **Resource reads bypass the permit path entirely.** `resources.ts:319-322` returns `read: (uri) => contents.get(uri)` over a map built once at server construction, and the `ReadResourceRequestSchema` handler at `surface.ts:192-204` never touches `authInfo`. Tool calls do (`surface.ts:147`, `packages/mcp/src/build.ts:848-874`).

So the mechanism exists. What is missing is the decision about which Wayfinder facts belong in it, under what URI grammar, and what moving a fact from a tool to a resource costs.

### Where this sits in the broader tool-shape audit

The Trails operator MCP surface is under a wider naming and tool-shape audit — one server, eight domains, and open questions about `trails_<verb>_<domain>` versus `trails_<domain>_<verb>` naming and whether MCP needs CLI-style derivation machinery.[^audit] That audit explicitly asks "which capabilities should be resources, resource templates, or deferred tools rather than always-loaded tools?" and its Wayfinder child asks to "decide which facts should become MCP resources or resource templates" while keeping this ADR in view.

This ADR answers that question for Wayfinder only. It does not settle operator-wide tool naming, and it does not reshape Regrade, Warden, or the `inspect` trailhead. Wayfinder is the right first slice because it is the domain where the graph's stable identities are the whole point.

## Decision

### Stable identities are resources; everything else is a tool

The split is not "read versus write" — all of Wayfinder is read. The split is **addressability**.

> A Wayfinder fact belongs in MCP Resources when the caller can name it before
> asking for it. It belongs in a tool when the caller is asking the graph to
> find something.

If the client must already know a `trailId`, a `resourceId`, a `signalId`, a surface name, or a file path to make the request, the answer has a stable URI and belongs in the resource layer. If the request is a selector — a glob, a text query, a set of typed predicates, a relational walk, a comparison between two baselines — the answer has no stable identity and belongs in a tool.

This means:

- Browse and inspect stop consuming tool-list budget. A client with fifty trails in scope gets one resource listing instead of pressure to compress ten navigation tools into one.
- Tool descriptions get to be about queries, which is what they are good at describing.
- The graph's identities become the graph's addresses, which is what "the contract is queryable" has meant all along.[^tenets]

### Addressable resources and their URI grammar

The grammar is `trails://{kind}/{id}`, where `{kind}` names a graph entity kind and query parameters mirror the shared model's dimensions: `view` selects a view from `wayfinderViewSchema`, and `include` encodes the include axis from `wayfinderIncludeSchema`. Examples are an include, not a view — `wayfinderViewSchema` has no `examples` member (`packages/topography/src/wayfind/navigation.ts:43-51`) and the Wayfinding draft classifies them on the include axis — so the URI layer addresses them as `?include=examples` rather than minting an MCP-only view:

| URI | Fact |
|---|---|
| `trails://trail/{trailId}` | The saved trail record, rendered through the `describe` view. |
| `trails://trail/{trailId}?view=contract` | The shared contract payload: `id`, `kind`, `input`, `output`, `schema`, `resources`, `cli`, `payload`, `version` (`packages/topography/src/wayfind/queries.ts:1032-1044`). Examples, version history, and error facts stay on the include axis. |
| `trails://trail/{trailId}?include=examples` | Structured examples for one trail, addressed through the include axis. |
| `trails://resource/{resourceId}` | The saved resource record. |
| `trails://signal/{signalId}` | The saved signal record, with producer and consumer edges. |
| `trails://surface/{surfaceName}` | Resolved surface rendering facts for one surface. |
| `trails://source/{path}?view=outline` | Source outline for one explicit file, from the live-source path. |
| `trails://graph/overview` | The graph-level orientation view. |
| `trails://surface-map` | The resolved MCP surface rendering (already shipped). |

The table shows the primary families; the grammar covers every kind in `wayfinderEntityKindSchema` (`packages/topography/src/wayfind/filters.ts:11-19`), so `entity`, `trailhead`, and `version` address the same way — `trails://entity/{id}`, `trails://trailhead/{id}`, `trails://version/{id}` — rather than staying tool-only or growing unrecorded URI families.

Two encoding rules, both following what `resources.ts:146-150` already does:

- Entity IDs are percent-encoded as a single segment. Dotted trail IDs and scoped resource IDs survive intact.
- `source` is the exception: its `{path}` keeps literal `/` separators because a path *is* a path, with each segment percent-encoded. Flattening a file path into one opaque segment makes the URI unreadable for the one resource kind a human is most likely to read.

Parameterized kinds register as **resource templates**, not as eagerly enumerated listings. `resources/list` stays bounded — the singletons plus whatever the app chooses to surface eagerly — while `resources/templates/list` advertises the shape.[^mcp-spec] Eagerly enumerating one resource per trail per view does not scale past a toy topo, and it is the reason the graph family defaults off today.

### What stays a tool

Every dynamic behavior stays in the tool layer, and each keeps its own description because each answers a different question:

| Behavior | Why it cannot be a resource |
|---|---|
| Free-text `query` | The selector is the input; there is no identity to address. |
| Structured `where` — the typed population and predicate filters (`--trails`, `--intent read`, `--returns-error`, `--surface`) | The population is computed per call from an AND-ed predicate set. |
| Relational `from` / `to` / `around` — the `deps`, `impact`, and nearby walks | The result set is derived from a traversal, not stored under a name. |
| `map` | A rendering of graph shape around a resolved population, which is itself a query result. |
| `diff` | Two explicit graph baselines. It has a second root, so it is not a view over one resolved population.[^wayfinding] |
| `pattern` | A glob is list-shaped by definition. |

`pattern` deserves a note. It looks addressable because it takes a string, but a glob names a set the graph does not store under that name. It is a selector, and it stays a tool.

### Both layers render from the same resolver/filter/view model

Neither layer gets its own query semantics. The shared model already ships from `@ontrails/topography` and is imported by the operator CLI trail (`apps/trails/src/trails/wayfind.ts:3-9`):

```ts
import {
  deriveWorkspaceView,
  wayfinderIncludeSchema,
  wayfinderResolverSchema,
  wayfinderSourceModeSchema,
  wayfinderViewSchema,
} from '@ontrails/topography';
```

That is the seam this ADR builds on and does not move. ADR-0042 put durable graph facts and the reusable Wayfind catalog in `@ontrails/topography` and kept CLI and MCP wrappers app-owned; this decision stays inside that boundary.[^adr42]

Concretely:

- An MCP **resource read** is the `id` resolver plus one view (or, for include-addressed URIs, the include axis), carrying the URI's `{kind}` as the entity-kind filter and no other filters. A plain entity URI with no `view` parameter normalizes with the explicit `describe` view — the URI layer always names its view and never inherits the navigation tool's default, which is list-shaped and routes a bare ID target to the relational summary (`apps/trails/src/trails/wayfind.ts:664-670`). The singletons are the exception: they are not `{kind}/{id}` template instances, and `trails://graph/overview` normalizes to the targetless overview request — the `overview` view with no target and no kind, exactly what `wayfind --overview` issues. `graph` is not an entity kind (`wayfinderEntityKindSchema`, `packages/topography/src/wayfind/filters.ts:11-19`), and the navigation trail rejects `overview` paired with a target (`apps/trails/src/trails/wayfind.ts:625-630`). `trails://trail/tasks.create?view=contract` is `{ resolver: 'id', target: 'tasks.create', kind: 'trail', view: 'contract' }`. The kind is not decorative: the catalog's ID-only lookup deliberately fails ambiguous cross-kind collisions, so `trails://surface/user.show` and `trails://trail/user.show` must stay distinct requests instead of collapsing into one failing ID lookup.
- An MCP **tool call** is any other resolver, with filters and includes, exactly as the CLI issues it.
- Both return the same fact provenance envelope — `category`, `derivedFrom`, `source`, `drift` — because both read the same catalog.[^wayfinding]

The rule that follows: a URI is valid only if it normalizes into a resolver/filter/view request without lying. This is the resource-layer restatement of ADR-0050's test for surface accommodations — the surface may vary the ergonomics, but it may not vary the contract, and it may not hide which trail ran.[^adr50]

### Tools are the floor

Not every MCP client consumes resources. The fallback is not a compatibility shim bolted on later; it is a constraint on the resource layer:

> No Wayfinder graph fact is reachable only through a resource. Every
> addressable entity resource has a tool path that returns the same fact.

That path is the `id` resolver on the navigation tool. `trails://trail/tasks.create?view=contract` and a navigate call with `{ target: 'tasks.create', kind: 'trail', view: 'contract' }` return the same payload from the same catalog, and the graph-facts family is already derived from the tool population (`resources.ts:136-144`), so nothing can drift out of tool reach by construction.

The floor rule names a contract change the implementation carries: the navigation trail's public input gains an optional entity-kind discriminator, propagated through its target dispatch. Today `wayfind.navigate` expresses kind only through population flags (`--trails`, `--surfaces`, and peers map to `kind` filters at `apps/trails/src/trails/wayfind.ts:302-315`) and its ID-target dispatch omits kind entirely, so a kind-qualified URI's tool equivalent would still hit the catalog's ambiguous ID-only lookup. The catalog already models the discriminator (`kind` at `packages/topography/src/wayfind/queries.ts:117`); the trail contract has to surface it before the floor rule is true for colliding IDs.

The floor rule is scoped to Wayfinder's entity resources. `trails://surface-map` sits outside it: its payload is the resolved MCP tool rendering itself (`buildSurfaceMap` at `packages/mcp/src/resources.ts:129-134`), and a tools-only client already receives that information natively through MCP's own `tools/list` negotiation — a dedicated tool restating the tool list would be ceremony, not capability.

Clients that ignore resources lose discovery ergonomics and cold-context loading. They do not lose capability. Clients that never negotiate the capability never see it advertised, because `surface.ts:87-98` only declares `resources` when the app built them.

### Resources read locked artifacts; `live` stays a tool argument

The `--source` axis has two values, and only one of them is addressable. `locked` reads committed Topography artifacts and is deterministic — the same URI returns the same bytes until the lock changes. `live` derives an in-memory graph from the current app, which means the same URI would return different content on every read depending on the working tree.

Graph-fact resources are `locked` only. `source` is not a URI parameter. `trails://surface-map` is the standing exception, on the same grounds as its floor-rule exemption: it describes the running server's resolved tool rendering — including call-site trailhead overrides (`DeriveMcpToolsOptions.trailheads`, `packages/mcp/src/build.ts:123-128`) — so its content is bound to the live rendering by definition, and pinning it to a lock would make it lie about the server it ships from. A caller who wants live derivation calls the tool and passes `source: 'live'`, and gets the same explicit no-fallback behavior the Wayfinding draft settled: ask for `locked` with no artifacts and get an absent diagnostic; ask for `live` and get the load failure.[^wayfinding]

For the shipped families, locked-only is a behavior change and must be an explicit one. `buildMcpResources` today builds `trails://trail/{trailId}`, `trails://examples/{trailId}`, and `trails://surface-map` from the in-memory `Topo` at server construction (`packages/mcp/src/resources.ts:281-321`), lock or no lock. Cutting those URIs over to locked-only changes their source, availability, and payload for clients that already read them. That cutover ships with the same reconciliation ruling as the examples URI below — alias, versioned URI, or pre-1.0 hard cutover — rather than landing silently inside an implementation PR.

`trails://source/{path}?view=outline` is the one seam worth naming. Source outlines are the CLI's declared live-source exception — `trails wayfind file <file> --outline` parses the explicit file through `@ontrails/source` and cross-references saved artifacts when available. Making that addressable means a resource whose content tracks the working tree, which breaks the determinism the rest of the resource layer promises. It is listed above as the intended shape and deferred in implementation until the source axis has a stable resource contract, matching the Wayfinding draft's own posture on source-file resources. Its normalization is also the one that steps outside the entity-kind grammar: a source URI resolves through the `file` resolver rather than the `id` resolver, and `source` is deliberately not a member of `wayfinderEntityKindSchema` — settling that mapping is part of the deferred source contract.

### Permit and destructive posture

Wayfinder is read-oriented, which makes it tempting to skip this section. Two facts make that a mistake.

**Resources have no permit path.** Tool calls resolve a permit per invocation: `surface.ts:147` lifts the bearer token off `authInfo`, and `build.ts:848-874` hands it to the app's `resolvePermit`. Resource reads do neither. `surface.ts:192-204` handles `ReadResourceRequestSchema` without touching `authInfo`, and `resources.ts:321` is a synchronous lookup into a map built once at server construction. Moving a fact from a tool to a resource today moves it outside the only authorization hook MCP has in this codebase.

Two constraints follow:

- The resource population stays derived from the rendered tool population. Never wider. `exposedTrailIds` already enforces this and must keep doing so as new kinds land.
- A resource layer that carries permit-sensitive facts needs a per-read permit hook first. Until that exists, hosts that expose Wayfinder over MCP apply their own auth or workspace boundary, exactly as ADR-0027 and the Wayfinding draft already require for the `include` allowlist.[^adr27] Exact include is a rendering choice, not an authorization boundary.

**Resources have no annotation vocabulary.** MCP annotations are tool-shaped. `packages/mcp/src/annotations.ts:49-74` derives `readOnlyHint` from `intent: 'read'` and `destructiveHint` from `intent: 'destroy'`; `write` gets neither, and `openWorldHint` is declared in the type at `annotations.ts:11-17` but never assigned. A resource carries no equivalent hint. So read-only-ness has to be structural: a resource read is itself a read operation over locked facts. Facts about write and destroy trails stay addressable — the shipped builder already includes every MCP-exposed trail regardless of intent (`resources.ts:252-268`) and records the subject trail's intent as payload data (`resources.ts:220-235`) — it is the read of those facts that is non-mutating, not the trails they describe. Any Wayfinder tool that mutates anything is a category error, not an annotation problem.

The Wayfinder navigation tools stay `intent: 'read'` and therefore carry `readOnlyHint: true` for free. `wayfind.navigate` declares `intent: 'read'` at `wayfind.ts:1184`; the selector trails do the same. Nothing in this decision introduces a destructive Wayfinder tool.

## Non-goals

- **Implementing the MCP resource surface.** This ADR settles the split, the grammar, and the constraints. Handler wiring, template registration, and the per-read permit hook are implementation work.
- **Redesigning unrelated MCP tools.** Regrade, Warden, the `inspect` trailhead, and operator-wide tool naming belong to the broader audit.[^audit]
- **Collapsing Wayfinder into one catch-all MCP tool.** The dynamic behaviors keep distinct tools with distinct descriptions. Resources reduce the tool count by removing what was never a query, not by compressing what is.
- **Changing the query model.** No new resolvers, filters, or views. This is a rendering decision over the model the Wayfinding draft already settled.

## Consequences

### Positive

- **Browse stops competing with query for tool-list budget.** The facts a client can name move out of the tool list, which leaves the remaining tools room to describe one behavior each — the thing overloaded tools were always failing at.
- **Cold context becomes addressable.** A client can pull `trails://trail/{id}?view=contract` for the three trails it cares about instead of calling a tool, waiting, and paying for the round trip. The operator surface already tells clients to do this: "Use MCP resources for cold context, direct tools for high-signal work" (`mcp-options.ts:82-83`).
- **CLI and MCP converge on one grammar.** Today the CLI routes through `wayfind.navigate` and MCP exposes ten catalog trails. After this, both express the same resolver/filter/view request and the divergence has a name.
- **Templates make the graph browsable without enumerating it.** `resources/templates/list` advertises the shape; the graph-facts family stops needing to default off to avoid flooding `resources/list`.

### Tradeoffs

- **Two rendering paths to keep aligned.** A fact reachable as both a resource and a tool result is a place where the two can drift. Mitigated by both reading one catalog, and by the resource population being derived from the tool population rather than declared separately.
- **URI grammar is a compatibility surface.** `trails://` URIs get pasted into agent skills, notes, and prompts. Once agents cite them, changing the grammar costs more than changing a tool name. This is why the grammar is settled in an ADR rather than in the implementation.
- **The resource layer is currently unauthenticated by construction.** Naming that plainly is the tradeoff. The alternative — leaving graph facts in tools solely to inherit the permit hook — keeps a working authorization path but keeps the tool-count problem this ADR exists to solve.

### Risks

- **Resource-first agents may over-fetch.** A client that eagerly reads every advertised resource turns cold context into a context-window flood. Mitigation: keep `resources/list` bounded and push per-entity kinds behind templates, so eager reads require an ID the client already has.
- **Percent-encoded IDs are hostile to hand-editing.** Any entity ID whose characters require percent-encoding round-trips correctly but reads badly in the URI. Mitigation: resource listings carry human-readable `name` and `description` fields already (`resources.ts:50-55`), so the URI does not have to carry the legibility.
- **Template support is uneven across clients.** A client that implements `resources/read` but not `resources/templates/list` sees a nearly empty resource listing and no way to discover the shape. Mitigation is the floor rule: those clients fall back to tools and lose nothing but ergonomics.

## Non-decisions

- **How the shipped resource URIs cut over.** Two reconciliations share one ruling: `trails://examples/{trailId}` versus `trails://trail/{trailId}?include=examples` (an include addressed as a kind), and the shipped in-memory families versus this ADR's locked-only sourcing. The options are a pre-1.0 hard cutover, a retained alias, or leaving the inconsistency. Both touch the general MCP resource layer rather than Wayfinder alone, so they want a ruling rather than a maintainer's guess.
- **Operator MCP tool naming.** Whether Wayfinder's tools stay under `trails_wayfind_*` or move to a compact `trails_find_*` / `trails_show_*` shape belongs to the audit's naming doctrine, not here.[^audit]
- **The per-read permit hook's shape.** Whether resource reads should resolve permits through the same `resolvePermit` contract as tools, or whether the resource layer should stay permit-free and rely on host boundaries, is an MCP surface decision this ADR only constrains.
- **Whether resource URIs should be derived rather than authored.** The grammar here is a derivation rule over trail IDs and entity IDs, but nothing yet enforces that an app cannot author its own. Whether that needs a Warden rule waits until the surface exists.
- **HTTP and WebSocket equivalents.** Surfaces are peers, and stable graph identities suggest an obvious HTTP shape. This ADR does not decide it.
- **Live-source resource contract.** `trails://source/{path}?view=outline` is named, not shipped. The determinism question stays open until the source axis has a stable resource contract.

## References

- [Wayfinding (draft)](20260503-wayfinding.md) — establishes the resolver/filter/view navigation model, the `--source` axis, the drift envelope, and the resources-versus-tools split this ADR specifies
- [ADR-0027: Trail Visibility and Surface Filtering](../0027-visibility-and-filtering.md) — the visibility levers that keep Wayfinder internal by default and gate MCP exposure behind explicit includes
- [ADR-0035: Surface APIs Render the Graph](../0035-surface-apis-render-the-graph.md) — surfaces render the graph rather than defining their own model, which is what forbids an MCP-only query semantics
- [ADR-0042: Core/Topography Boundary Doctrine](../0042-core-topography-boundary-doctrine.md) — places the reusable Wayfind catalog in `@ontrails/topography` and keeps CLI and MCP wrappers app-owned
- [ADR-0050: Surface Accommodations Preserve Trail Identity](../0050-surface-accommodations-preserve-trail-identity.md) — the normalize-without-lying test this ADR restates for resource URIs
- [ADR-0052: Overlays Are the Lock's One Extension Mechanism](../0052-overlays-one-extension-mechanism.md) — the extension mechanism any lockable surface binding must use, which resource URIs must not become a second route around

[^wayfinding]: [Wayfinding (draft)](20260503-wayfinding.md), sections "Navigation catalog", "Distinct command", "Source selection", "MCP graph resources", and "Fact provenance envelope".
[^wayfinding-risk]: [Wayfinding (draft)](20260503-wayfinding.md), Risks, "MCP surface shape".
[^mcp-spec]: The Model Context Protocol's resource methods — `resources/list`, `resources/read`, and `resources/templates/list`. `@ontrails/mcp` takes `@modelcontextprotocol/sdk` as a peer dependency at `^1.28.0` (`packages/mcp/package.json:33`), resolved to `1.28.0` in `bun.lock:614` and currently registers handlers only for the first two (`packages/mcp/src/surface.ts:181-204`). Spec: <https://modelcontextprotocol.io>.
[^audit]: The operator MCP app audit — parent [TRL-1137](https://linear.app/outfitter/issue/TRL-1137) and Wayfinder child [TRL-1139](https://linear.app/outfitter/issue/TRL-1139), which asks to reconcile with TRL-1035. The audit's originating working note lives in the repo-local (gitignored) `.agents/notes/` area; the Linear issues are the inspectable record.
[^tenets]: [Trails Design Tenets](../../tenets.md), "The contract is queryable" and "Surfaces are peers".
[^adr27]: [ADR-0027: Trail Visibility and Surface Filtering](../0027-visibility-and-filtering.md).
[^adr42]: [ADR-0042: Core/Topography Boundary Doctrine](../0042-core-topography-boundary-doctrine.md).
[^adr50]: [ADR-0050: Surface Accommodations Preserve Trail Identity](../0050-surface-accommodations-preserve-trail-identity.md).
