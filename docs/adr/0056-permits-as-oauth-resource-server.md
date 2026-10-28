---
id: 56
slug: permits-as-oauth-resource-server
title: Permits Make Trails an OAuth Resource Server
status: accepted
created: 2026-10-28
updated: 2026-10-28
owners: ['[galligan](https://github.com/galligan)']
depends_on: [10, 12, 26, 35, 52, 55]
---

# ADR-0056: Permits Make Trails an OAuth Resource Server

## Context

Trails already separates permit declarations, credential extraction, and scope enforcement. [ADR-0012](0012-connector-agnostic-permits.md#decision) established that model, but left discovery, challenges, actor identity, and long-lived authorization unsettled. Its historical MCP handshake and bearer-only descriptions do not establish the resource-server contract that the stateless MCP surface needs.

This decision ratifies the resource-server direction recorded in [TRL-1429] and the October 27 auth draft.[^draft] It amends ADR-0012 while retaining explicit scope declarations, `permit: 'public'`, surface-agnostic implementations, and exact-match scope enforcement. It records the target contract; accepting this ADR does not establish that every implementing issue has shipped. [ADR-0055](0055-mcp-stateless-core-on-sdk-v2.md#authorization-is-resolved-for-every-request) owns the MCP request and hosting boundary.

## Decision

### The authorization server stays outside the topo

Trails verifies credentials and enforces permits. It does not sign users in, run consent screens, register OAuth clients, or mint OAuth user tokens. An app chooses its authorization server: Better Auth, Clerk, Cloudflare Access, WorkOS, Auth0, Supabase, or its own provider. A provider may run beside a Trails app, but the provider's sign-in server is not a trail or a new Trails primitive.

The wiring remains in `@ontrails/permits`; there is no `@ontrails/auth` package. CLI login is a client of the selected authorization server and has its own decision under [TRL-1496]. Provider packaging is recorded separately by [TRL-1432]. Neither expands Trails into an authorization server.

### Two verification paths produce the same Permit

The built-in `jwt` adapter has two configuration modes. A `secret` selects HS256, preserving optional issuer and audience checks. Without a secret, `issuer` and expected `audience` select OIDC discovery or RFC 8414 metadata, followed by local JWT verification using cached JWKS. That path verifies RS256, ES256 and EdDSA, supports `kid` rotation, checks `iss`, `aud` and `exp`, and maps claims into a `Permit`. API access credentials and explicitly supported workload credentials share verification machinery under adapter policy for their intended purpose; a signed login ID token is not thereby an API access token. [TRL-1435] owns the implementation and its supported key curves, cache policy and compatibility details; ADR-0010 and ADR-0012 already authorize the JWKS capability.

Legacy HS256 configuration compatibility does not exempt an OAuth-protected surface from security policy. Such a surface enforces its configured trusted issuer/key context and expected audience regardless of signature algorithm, and distinguishes accepted credential purposes.[^jwt-use]

Opaque lookup is the other path. An adapter resolves an API key or opaque token and returns the same `Permit` contract; it may use a portable store or a provider connection such as a Service Binding. [TRL-1439] owns that path. The credential type does not create a different enforcement pipeline.

Short-lived credentials are the documented default. Static API keys remain supported, with provider-side exchange for short-lived tokens preferred where available. A bearer adapter must reject sender-constrained tokens whose binding it cannot verify; this decision does not add DPoP verification.

### Surfaces normalize credentials without owning identity policy

`PermitExtractionInput` can carry bearer credentials, API-key headers such as `x-api-key` or `x-auth-token`, edge assertions such as `Cf-Access-Jwt-Assertion`, or a same-origin session cookie. The adapter decides which credential sources it trusts. Credentials never come from query strings, including browser WebSocket URLs.

Shared code in `@ontrails/permits` owns verification, effective-permission calculation, protected-resource metadata, and challenge formatting. [TRL-1468] owns this surface contract and metadata derivation. Each surface supplies three facts:

| Surface responsibility | Meaning |
| --- | --- |
| Operation resolution | Identify the selected trail before its implementation runs: an HTTP route, MCP tool, or RPC method. |
| Credential input | Normalize the surface's credential into `PermitExtractionInput`. |
| Challenge rendering | Render shared auth outcomes using the surface's native response contract. |

MCP HTTP authorization is resolved for every request. A former session ID, a connection, or caller-supplied `_meta` is not proof of identity. Resource reads and permit-filtered discovery follow the same boundary as tool calls. Stdio stays outside OAuth; CLI and stdio may obtain credentials through their explicit configuration. The SDK migration and portable MCP handler remain owned by ADR-0055 and [TRL-1340].

This surface contract does not replace the shared error taxonomy. [ADR-0026](0026-error-taxonomy-as-transport-independent-behavior-contract.md#decision) owns categories and behavior; [ADR-0035](0035-surface-apis-render-the-graph.md#decision) owns rendering and hosting. An HTTP authorization challenge before execution is distinct from a trail failure rendered as an MCP tool result. Protocol failures retain the MCP/RPC protocol-error boundary.

### Discovery and challenges derive from the selected trail contracts

The resource server renders RFC 9728 metadata and challenges from auth configuration and the trails exposed by that surface.[^metadata]

| Rendered fact | Owner |
| --- | --- |
| Protected-resource metadata at the RFC 9728 well-known location | Auth resource configuration: protected-resource URL and `authorization_servers`, with the primary issuer first. |
| `scopes_supported` | The union of declared permit scopes on exposed trails, derived when metadata is rendered. |
| HTTP 401 with `resource_metadata` and required `scope` | No valid credential for a protected trail. |
| HTTP 403 with `error="insufficient_scope"` and required scopes | A valid credential lacks the trail's required scopes. |
| A trail callable without sign-in | Its explicit `permit: 'public'` declaration. |

Challenges use genuine 401 or 403 responses, not advice inside a successful response. HTTP and Streamable HTTP MCP use `WWW-Authenticate`; WebSocket frames carry the corresponding auth facts in the shared RPC error rendering. Provider-specific client-registration rules stay with the authorization server.

Issuer, protected-resource URL, and expected audience are three distinct configuration values. Reject tokens that do not match the expected audience. A provider may use the protected-resource URL as its audience or map that resource to another identifier, as RFC 8707 permits; do not infer equality from the URL alone.[^audience]

Public protected-resource metadata and the exposed scope union can be cached. Responses filtered by a permit, including tool lists or per-subject resources, use `Cache-Control: private, no-store` and `Vary: Authorization, Cookie`. An immutable lock does not make an authorization-dependent response public. ADR-0055 separately derives MCP cache freshness and audience scope.

### Roles expand at the adapter boundary and never widen scoped consent

Core enforcement remains scopes-only and exact-match. The app authors its role map and actor ceilings once through an app-authored `permits.roles` overlay under [ADR-0052](0052-overlays-one-extension-mechanism.md#decision). Adapters expand roles before `executeTrail` enforces the resulting scopes. Trails continue declaring scopes, keeping their contracts portable across apps.

Effective permission is an intersection whose terms depend on the credential:

| Credential | Effective scopes |
| --- | --- |
| OAuth access token carrying scope | Token scopes ∩ role expansion, when roles are supplied ∩ current-actor ceiling. |
| Explicitly supported role-only credential | Role expansion ∩ current-actor ceiling. |
| API key | Stored key scopes ∩ the owner's current role expansion ∩ current-actor ceiling. |
| Exchanged token | The scoped-token calculation, bounded by the scopes actually issued under the authorization server's exchange policy. |
| Stored subscription grant | Grant scopes ∩ the subject's current role expansion ∩ current-actor ceiling at revalidation. |

A scoped read-only token remains read-only even when its subject is an administrator. If a scoped token supplies no roles, its role term drops out; its consented scope still bounds access. A role-only credential with no mapped roles yields no scopes. Role-only behavior is explicit adapter policy, never a fallback for an OAuth token missing its scope claim.

The role overlay feeds Wayfinder role queries, Warden role-scope checks, tests, CLI permit selection, and lock diffs. Unknown provider roles produce adapter warnings. [TRL-1447] owns the overlay, and [TRL-1453] owns effective permission. New persisted role facts retain the campaign's lock-v6 gate under [TRL-1424].

### Identity includes the issuer and the current actor

`Permit.id` remains the subject whose authority is being used. `Permit.issuer` identifies who vouched for it; routing, ownership and stored authorization use issuer plus subject, plus `tenantId` where applicable. A bare subject or email is not a sufficient routing key across issuers.

The permit adds `expiresAt`, derived from credential expiration, and an ordered `actors` chain, nearest/current actor first. This is the intended actor contract; [TRL-1442] owns the actual public type and migration:

```typescript
interface PermitActor {
  readonly id: string;
  readonly kind: string;
  readonly verified: boolean;
}
```

Known actor kinds include `client`, `agent`, `service` and `workload`, but the set remains open. Client claims such as `client_id` or `azp` and RFC 8693 `act` nesting supply the chain when the issuer vouches for them. Caller assertions remain visibly unverified.

Only the current actor affects access control: the outermost `act`, or the client claims when `act` is absent. Earlier actors are audit history, not additional enforcement terms. This follows RFC 8693 §4.1; any delegation restrictions that must affect enforcement must be represented in the exchanged token's top-level scopes, not inferred from actor history.[^actors] Actor ceilings may narrow current-actor authority by kind or ID. An unverified current actor can trigger a restrictive ceiling but cannot satisfy an exception that widens access.

### Step-up reuses the permission outcome

An intent-aware policy may require step-up when a non-human actor reaches a destructive trail. The plain denial remains the existing `permission` category: `PermitError`, HTTP 403, `context.code: 'step_up_required'`, and `context.requiredScopes`. [TRL-1454] owns this plain step-up rule and outcome. It adds no surface-specific error category.

The generic surface-agnostic elicitation decision under [TRL-1483] owns the input-required outcome. [TRL-1488] owns rendering the already-defined step-up outcome on MCP, including the intended URL-mode consent path. That consent exchange does not replace the plain permission denial. Replay authorization and paused state retain their separate governing issues; this ADR does not prescribe a new retry mechanism.

### Long-lived connections preserve identity while refreshing authority

Request authentication always checks token expiration. Request-scoped surfaces need no refresh scheduler; long-lived surfaces enforce `Permit.expiresAt` as an authorization deadline while clients coordinate renewal through the concrete surface protocol. Local JWT verification alone cannot detect revoked consent before token expiration, so short lifetimes bound that exposure.

Resolve WebSocket identity before upgrade when possible: an Authorization header for non-browser clients, a same-origin cookie, or a connection ticket. `@ontrails/permits` owns the ticket: an authenticated HTTP call returns a single-use base64url value lasting about 30 seconds and bound to issuer, subject and tenant. The client offers subprotocols `trails.v1` and `ticket.<value>`; the server selects `trails.v1` and consumes the ticket on upgrade. The ticket is bound to this protected resource and preserves the originating verified Permit's effective scopes, current-actor ceiling and credential expiration; consumption never reconstructs broader authority from subject identity alone. Its admission lifetime cannot extend the originating credential's validity. This is a connection credential, not an OAuth user token minted by Trails.

`trails.auth` is a client-to-server request for initial authentication or refresh. A connection without identity may authenticate through that first request, in its own per-connection state. Refresh can extend expiration or narrow authority but cannot change issuer, subject or tenant; an identity change closes with 1008. Scopes are checked on every protected invocation and delivery. Expiration without fresh credentials also closes with 1008. [TRL-1479] and the RPC/WebSocket decision under [TRL-1166] own the concrete connection protocol and in-flight behavior. That protocol must specify how each supported client credential kind learns the expiration deadline and schedules refresh; server-internal expiration or ticket admission lifetime alone is insufficient. This ADR introduces no reverse-direction `trails.auth` method or new server prompt.

### Stored grants retain authorization history

A durable subscription has no present caller token to verify. Its grant records issuer-qualified subject and tenant, actor chain, effective scopes at creation, and a delegation reference when it acts on a user's consent. The subscriptions decision under [TRL-1497] owns the subscription entity and delivery model; this ADR owns the authorization facts. [TRL-1464] implements the grant.

Bounded grants default to 30 days regardless of the credential that created them. A derived renew trail runs under a freshly authenticated permit obtained through surface credential extraction and extends the grant in place, preserving subscription ID and cursor. Raw credentials do not become renew-trail input or stored grant data. A typed expiring signal arrives on the subscription's delivery channel, defaulting to three days before expiry. Sliding renewal is opt-in; successful revalidation can extend the grant only while the subject, scopes and delegation remain valid.

Revalidation checks that the subject is active, scopes still fit current roles and the current actor's ceiling, and delegated consent remains live. Webhooks revalidate per delivery with a short cache; queues revalidate when drained. Never-expiring or sliding delegated grants require an adapter capable of checking the delegation. JWKS verification alone is insufficient; an adapter without introspection or a consent-checking API must keep those grants bounded. That bounded fallback is an accepted exposure limit, not proof that consent is still live. An adapter reports only the checks it can perform; an actual observed expiry or revalidation failure still stops delivery.

Each delivery checks tenant equality before scopes. Expired or failed grants stop delivery while retaining the subscription cursor. Events committed during a lapse were not authorized for that subscriber: skip them and report typed `authorization_gap`, distinct from retention's `replay_gap`. Initial tenant filtering uses a declared tenant key path; optional per-record authorization predicates are later work.

The grant stores authorization intervals with opening and closing outbox positions, times and causes: `expired`, `revoked`, `revalidation_failed` or `narrowed`. Compare event positions against these global outbox positions; the consumer cursor remains a separate opaque checkpoint mapped through the delivery log. Renewal opens a new interval at the outbox head and never reopens the lapsed interval.

For expiry, close at the scheduled expiration. For revocation with a provider timestamp, use that revocation time. For revocation without a timestamp, use the last successful revalidation before the first observed failure; never substitute a later scheduled expiry for an earlier revocation. Translate that time conservatively to the last outbox position committed at or before the cutoff minus a clock-skew allowance, default five minutes and configurable on the auth resource. Never close later than the first observed failure position. Unknown authorization shortens an interval; it does not authorize replay. Deliveries already made in the revalidation window remain explicit audit facts.

Retain interval history at least as long as outbox retention, then compact to the newest interval. An event must belong to an authorized interval and pass current checks to be delivered. Renewal preserves authorization continuity, not replay availability: the initial outbox retention is 33 days, and a consumer outside it still receives `replay_gap`. Transactionality, ordering, checkpoints and gap delivery remain owned by the subscriptions model and [TRL-1505].

### Auth facts use the existing lock and deployment owners

The `auth` resource declares secret names, never values. Issuer, protected-resource URL and expected audience are selected per deployment profile; derive the resource URL from the deployed origin where possible, without conflating it with audience. Portable API-key lookup uses role-level `kv` or `store` contracts. A host-bound adapter such as Cloudflare Access is marked target-locked so portability checks can report it. The deploy decision under [TRL-1438] owns deployment facts and secret rotation; [TRL-1540] owns profile secret names.

Challenge scopes are derived facts on each trail's own lock entry. `scopes_supported` is rendered from those entries, not stored as an aggregate conflict point. The only auth overlay namespace introduced by this decision is `permits.roles`. [TRL-1475] owns challenge-fact storage; the lock-v6 decision remains its prerequisite. No extra namespace or per-kind lock extension is authorized here.

Build the compose-scope Warden check promised by ADR-0012: a composing trail declares every scope required by the trails it composes. [TRL-1450] owns that implementation; accepting either ADR is not evidence that the rule already runs. Runtime composition still enforces each trail's permit.

Provider adapters remain thin presets or claim mappers over the two verification paths. First targets are Better Auth with its Workers recipe, designed alongside Cloudflare Access, then Clerk. WorkOS, Auth0 and Supabase begin as documented JWKS presets. [TRL-1432] owns exact packages/subpaths and optional SDK dependencies; this ADR does not duplicate that packaging decision.

### Initial release and later work remain distinct

The initial auth program includes JWKS and opaque lookup; issuer-qualified Permit identity, expiration and actors; effective permission, role expansion and ceilings; HTTP and Streamable HTTP MCP metadata/challenges through the surface contract; compose-scope governance and per-trail challenge facts; Better Auth plus its Workers recipe; and Cloudflare Access.

Clerk follows those first adapters. Stored grants, renewal and delegation revalidation land with the durable subscriptions model. WebSocket credential refresh lands with the RPC surface. Issuer-metadata compatibility checking and providers beyond the documented presets remain later work. The separate CLI decision owns its initial login and credential features.

This sequence preserves the actual dependencies: MCP challenges require the shared surfaces kernel and handler; new persisted auth facts require lock-v6; the Workers recipe requires the Cloudflare overlay/helper path; subscriptions require the durable model, outbox and grant together. Accepted direction permits focused implementation; it does not erase those integration and merge gates.

## Consequences

One set of authored permit scopes feeds enforcement, discovery, challenges and governance. One role map feeds expansion, inspection, tests and audit. Surface-specific credential extraction remains small while authorization policy has one owner. Keeping the authorization server outside the topo lets apps choose providers without adding a second Trails identity model.

The Permit contract grows, and code constructing permits by hand will need migration guidance and a package changeset under [TRL-1442]. Provider roles can still drift from the authored map; warnings and Warden make the mismatch visible, not impossible. Grant revalidation adds provider capability requirements and a bounded revocation window. Conservative authorization cutoffs can skip events whose authority is uncertain; they do not silently widen access.

This is documentation-only release intent (`release:none`). It changes no runtime package, public type, lock schema or deployed provider. Implementing issues must carry their own tests, documentation, governance, migration and changeset obligations. This ADR does not prove connector interoperability or authorize publication, provisioning or deployment.

## Open items and boundaries

- A derived check of issuer discovery metadata against Claude and ChatGPT requirements remains deferred until the first provider adapter. Do not infer current connector interoperability from this ADR or from SDK installation.
- Enterprise managed authorization and workspace domain restrictions remain a later decision.
- CLI sign-in and credential storage belong to [TRL-1496]; per-record ownership remains implementation logic; MCP elicitation, RPC hosting, subscriptions and deployment retain their named owners.
- Future ADR references must resolve to their actual accepted or draft sources as they become available. Issue links below identify unsettled companion work without inventing accepted ADR numbers.

## References

- [ADR-0010](0010-native-infrastructure.md#decision) — built-in infrastructure and adapters.
- [ADR-0012](0012-connector-agnostic-permits.md#decision) — explicit permit declarations and shared enforcement, amended here.
- [ADR-0026](0026-error-taxonomy-as-transport-independent-behavior-contract.md#decision) — shared error behavior.
- [ADR-0035](0035-surface-apis-render-the-graph.md#decision) — surface rendering and hosting ownership.
- [ADR-0052](0052-overlays-one-extension-mechanism.md#decision) — the lock's extension mechanism and provenance boundary.
- [ADR-0055](0055-mcp-stateless-core-on-sdk-v2.md#authorization-is-resolved-for-every-request) — stateless MCP request context and Auth's policy seam.
- [TRL-1483], [TRL-1488], [TRL-1497], [TRL-1438], and [TRL-1166] — elicitation/step-up, durable subscriptions, deployment, and RPC/WebSocket companion decisions.

[TRL-1166]: https://linear.app/outfitter/issue/TRL-1166
[TRL-1340]: https://linear.app/outfitter/issue/TRL-1340
[TRL-1424]: https://linear.app/outfitter/issue/TRL-1424
[TRL-1429]: https://linear.app/outfitter/issue/TRL-1429
[TRL-1432]: https://linear.app/outfitter/issue/TRL-1432
[TRL-1435]: https://linear.app/outfitter/issue/TRL-1435
[TRL-1438]: https://linear.app/outfitter/issue/TRL-1438
[TRL-1439]: https://linear.app/outfitter/issue/TRL-1439
[TRL-1442]: https://linear.app/outfitter/issue/TRL-1442
[TRL-1447]: https://linear.app/outfitter/issue/TRL-1447
[TRL-1450]: https://linear.app/outfitter/issue/TRL-1450
[TRL-1453]: https://linear.app/outfitter/issue/TRL-1453
[TRL-1454]: https://linear.app/outfitter/issue/TRL-1454
[TRL-1464]: https://linear.app/outfitter/issue/TRL-1464
[TRL-1468]: https://linear.app/outfitter/issue/TRL-1468
[TRL-1475]: https://linear.app/outfitter/issue/TRL-1475
[TRL-1479]: https://linear.app/outfitter/issue/TRL-1479
[TRL-1483]: https://linear.app/outfitter/issue/TRL-1483
[TRL-1488]: https://linear.app/outfitter/issue/TRL-1488
[TRL-1496]: https://linear.app/outfitter/issue/TRL-1496
[TRL-1497]: https://linear.app/outfitter/issue/TRL-1497
[TRL-1505]: https://linear.app/outfitter/issue/TRL-1505
[TRL-1540]: https://linear.app/outfitter/issue/TRL-1540

[^draft]: [Connected resource-server draft](https://app.notion.com/p/4061b36f46cb81b08730dceafbbc5d26), identifying original Claude revision 19 copied October 28, 2026; [auth and RBAC plan](https://app.notion.com/p/4061b36f46cb8195a0f8f35043857f3b). The primary draft records Matt's October 27 direction and later design-review corrections. This ADR preserves those decisions while distinguishing future implementation and companion ownership.
[^metadata]: [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html), §§2, 5 and 7.2: protected-resource metadata, challenge discovery, and the scope-disclosure boundary. Per-trail derivation is Trails' decision.
[^audience]: [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html#section-2): a resource indicator can map to a distinct audience identifier.
[^actors]: [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html#section-4.1): current-actor enforcement and informational prior actors.

[^jwt-use]: [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html#section-3.9), §§3.9 and 3.12: audience validation and mutually exclusive validation rules for different JWT uses.
