---
id: 57
slug: auth-adapter-packaging
title: Provider Auth Adapters Own Their Package Boundaries
status: accepted
created: 2026-10-28
updated: 2026-10-28
owners: ['[galligan](https://github.com/galligan)']
depends_on: [10, 29, 51]
---

# ADR-0057: Provider Auth Adapters Own Their Package Boundaries

## Context

[ADR-0010](0010-native-infrastructure.md#adapters-are-the-integration-point) sketched provider-specific subpaths inside `@ontrails/permits`. [ADR-0029](0029-connector-extraction-and-the-with-packaging-model.md#adapters-stay-extracted-into-adapters) subsequently established `adapters/` as the home for integrations with their own dependency and contribution boundary. Auth needs one rule that follows that ownership model without making every JWT issuer a package.

[TRL-1432] records Matt's October 27 decision: shared auth wiring and JWKS remain in `@ontrails/permits`, while selected provider adapters have their own packages or live within an existing adapter collection. The connected working plan also says a provider earns a package only when its mapping needs the provider SDK, yet names an SDK-free Better Auth JWT preset as an extracted package.[^plan] Those statements need an explicit reconciliation; adding an unused SDK dependency would not resolve the ownership question.

## Decision

### Shared verification remains owned by permits

`@ontrails/permits` owns auth wiring, the adapter port, JWT/JWKS verification, opaque lookup, and the shared effective-permission calculation as those capabilities are implemented. `@ontrails/permits/jwt` is the built-in provider-agnostic verifier. There is no `@ontrails/auth` package and no provider SDK dependency in the permits kernel.

Provider adapters configure and map the shared owners. They do not fork signature verification, claim validation, role expansion, or permission calculation. The dependency arrow points from an extracted adapter to the contracts it consumes, never from permits to every provider. [ADR-0051](0051-package-ownership-follows-natural-altitude.md#decision) remains the ownership test: consume the owner-owned contract instead of re-authoring its kernel.

### The selected targets have concrete homes

| Target | Workspace and public entry | Boundary |
| --- | --- | --- |
| Better Auth | `adapters/better-auth`, package `@ontrails/better-auth` | Provider compatibility, claim mapping, and the connection to its separately owned Workers recipe. Its JWT preset and claim mapper require no provider SDK. |
| Clerk | `adapters/clerk`, package `@ontrails/clerk` | SDK-free JWKS configuration and claim mapping, with an optional SDK-backed organization-role/permission capability. |
| Cloudflare Access | Existing `adapters/cloudflare` package, subpath `@ontrails/cloudflare/access` | Access header extraction and provider claim mapping within the Cloudflare collection; no standalone Access package. |
| WorkOS, Auth0, Supabase | Documented issuer/audience/claim presets for `@ontrails/permits/jwt` | No provider package or new permits export solely to wrap the same verifier. |

The Better Auth and Clerk packages are the explicitly selected extracted first targets. This is a named reconciliation of the source plan's general SDK-only wording in favor of the recorded first-target decisions and the provider compatibility boundary. It is not a claim that Better Auth needs an SDK, or a general exception for every vendor-named JWT preset.

Beyond these selected targets, the default remains a documented JWKS preset. A proposed dedicated provider package needs demonstrated integration work requiring its SDK and normal ownership review; SDK need is evidence for the boundary, not automatic authority to expand the approved package inventory. An adapter-collection subpath remains appropriate when an existing package already owns the external system, as Cloudflare does for Access.

Do not introduce `@ontrails/permits/better-auth`, `/clerk`, or `/openauth` from ADR-0010's historical sketch. The built-in JWT subpath remains canonical. [TRL-1482], [TRL-1491] and [TRL-1493] own implementing the named Better Auth, Access and Clerk targets respectively. The table establishes their homes, not published or verified availability.

### SDK dependencies belong to the capability that uses them

A concrete optional SDK-backed capability declares its SDK as an optional peer on the owning extracted adapter, using `peerDependencies` and the corresponding `peerDependenciesMeta` optional entry. Load it only when that capability is requested. Root imports, pure JWT use, and their public types must work when the optional peer is absent; runtime code and declaration imports must not eagerly require it.

For Clerk, `@clerk/backend` is the optional peer for the organization-role and permission path under [TRL-1493]. The base JWKS path remains SDK-free, including in Workers. Test the SDK-backed path against its actual runtime requirements rather than inferring portability from the base verifier. Better Auth has no SDK peer until an actual shipped capability needs one. Do not add empty optional peers or speculative SDK APIs to justify the chosen package name.

Requesting an SDK-backed capability without its peer fails at capability setup or adapter/resource materialization through an existing typed internal/configuration boundary. It is never a caller `AuthError`/401 or `PermitError`/403, and must not produce a sign-in challenge. [TRL-1493] owns the exact existing setup/result boundary and its tests; no new error category or adapter authentication-error code is introduced here. It must not silently ignore organization roles, widen authority, or fall back to another credential policy. When a capability inherently requires an SDK, its dependency contract must say so; marking a peer optional does not make that capability usable without it.

Each SDK-backed implementation proves three cases: base imports/JWT verification with the peer absent; the requested capability with a supported peer installed; and the requested capability with its peer missing. Supported ranges come from the concrete integration and verified provider guidance. A peer version does not establish the safety or version of a remotely deployed authorization server. Better Auth server-support and advisory qualification remain in [TRL-1482], and its Workers recipe remains in [TRL-1489].

### Host-bound adapters remain visible to portability checks

Cloudflare Access is a target-locked adapter capability. Its host/provider constraint must be recorded in the lock through the existing adapter-fact and overlay ownership so portability checks can report it. Packaging it under an existing collection does not make the constraint disappear, and the fact must describe the Access capability rather than silently classifying every Cloudflare export alike.

[TRL-1491] owns that adapter's concrete fact and tests. This decision creates no lock field or overlay namespace. The existing overlay mechanism and the campaign's lock-v6 prerequisites still govern any new persisted shape. JWKS verification and provider-neutral claim mapping remain reusable; a target-locked adapter must not pull host-specific dependencies into permits.

### Package ownership and publication are separate steps

At source baseline `37aad18fc`, the permits export map contains the root, `/jwt`, `/testing`, and `/package.json`, with no provider-specific subpaths. The selected Better Auth and Clerk workspaces and Access export are not implemented there. This ADR therefore reserves the implementation homes and amends the old sketch; it does not remove an existing source export or require a runtime import migration by itself.

Implementing each publishable adapter requires its own branch-local changeset, README, mock credential/JWKS coverage, and package validation. First-time packages need the repository's registry preflight and separately authorized publication path. All `@ontrails/*` packages follow current lockstep release policy; extraction establishes ownership and dependency boundaries, not a different release cadence. Supported provider versions, organization mappings, actual runtime portability, and live Workers proof remain implementation acceptance rather than assumptions supplied by this ADR.

This decision is documentation-only (`release:none`). It changes no package manifest, SDK version, export map, lock artifact, provider registration, credential or deployed authorization server. The resource-server decision under [TRL-1429] owns auth policy; this ADR owns placement and dependency isolation.

## Consequences

Applications can use the shared verifier without installing provider SDKs. Named provider adapters can evolve their compatibility and claim mappings without moving those responsibilities into the permits kernel. Cloudflare Access remains discoverable alongside the collection that owns its external system.

The explicitly selected Better Auth and Clerk packages add maintenance and distribution work even when the basic JWT path is small. That cost is accepted for their named provider boundary; it is not a template for additional presets. Optional SDK paths require absent-peer tests and import/type isolation, not merely manifest metadata. Target-lock facts and provider support ranges still need real implementation evidence.

## References

- [ADR-0010](0010-native-infrastructure.md#adapters-are-the-integration-point) — built-in infrastructure, amended provider-subpath sketch.
- [ADR-0029](0029-connector-extraction-and-the-with-packaging-model.md#composition-follows-responsibility-not-symmetry) — extracted adapters and collection/subpath boundaries.
- [ADR-0051](0051-package-ownership-follows-natural-altitude.md#decision) — shared kernels retain one owner.
- [TRL-1432] — governing packaging acceptance and the Clerk package-name decision.
- [TRL-1429] — resource-server policy, kept separate from packaging.
- [TRL-1482], [TRL-1491], [TRL-1493] — implementing adapter owners.

[TRL-1429]: https://linear.app/outfitter/issue/TRL-1429
[TRL-1432]: https://linear.app/outfitter/issue/TRL-1432
[TRL-1482]: https://linear.app/outfitter/issue/TRL-1482
[TRL-1489]: https://linear.app/outfitter/issue/TRL-1489
[TRL-1491]: https://linear.app/outfitter/issue/TRL-1491
[TRL-1493]: https://linear.app/outfitter/issue/TRL-1493

[^plan]: [Connected auth and RBAC plan](https://app.notion.com/p/4061b36f46cb8195a0f8f35043857f3b), “Adapter candidates and priority” and the October 27 packaging decision in “Open questions for Matt”; [connected resource-server draft](https://app.notion.com/p/4061b36f46cb81b08730dceafbbc5d26), “Provider adapters ship as their own packages.” Live TRL-1432/1482/1493 preserve the named target decisions and the general admission criterion; this ADR makes their reconciliation explicit.
