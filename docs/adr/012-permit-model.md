---
status: accepted
created: 2026-03-30
updated: 2026-03-30
author: '@galligan'
---

# ADR-012: Permit Model

## Context

### The vocabulary is already reserved

`ctx.permit` exists on `TrailContext` typed as `unknown`. The name is claimed. The question isn't whether auth belongs on the context — it's how to structure the type, how surfaces populate it, and how the framework enforces it.

### Surfaces resolve auth differently

HTTP reads a bearer token from the `Authorization` header. MCP receives a session token from the transport handshake. CLI might pull credentials from a keyring or environment variable. Each surface has its own extraction mechanism, but the trail implementation shouldn't know or care which one ran. The implementation needs a single, surface-agnostic permit — or the knowledge that no permit was required.

### Auth is a service + layer hybrid

Auth doesn't fit cleanly into one primitive. The auth provider (JWT verification, external identity service) is a service — it has lifecycle, configuration, and state. But enforcement is a layer — it wraps execution, short-circuits on failure, and runs on every invocation. The permit model needs to account for both halves without forcing them into one shape.

### Intent compounds with auth

A `destroy` trail with no auth requirement is a governance problem. Intent already tells the framework how dangerous a trail is (ADR-004). Permit declarations tell it who's allowed to trigger that danger. The two fields compound: the warden can flag unprotected destructive trails before deployment, not after an incident.

## Decision

### Explicit permit declarations, not convention-derived

The trail spec gains an optional `permit` field:

```typescript
const deleteUser = trail('user.delete', {
  intent: 'destroy',
  permit: { scopes: ['user:write'] },
  // ...
});
```

Auth is policy, not projection. `derivePermit()` is dropped entirely — scopes are always explicitly authored. Convention-derived scopes sound convenient, but they create a mapping that's invisible to the developer and hard to audit. Explicit scopes are easier to review, easier to grep, and harder to get wrong silently.

### `permit: 'public'` as first-class

The `permit` field is a union: `PermitRequirement | 'public'`. Public trails skip auth enforcement entirely. This is visible to the warden and to survey — an agent inspecting a topo can see which trails are open and which require credentials.

Omitting `permit` and setting `permit: 'public'` mean different things. Omission means the trail hasn't declared an auth posture. `'public'` means the trail has explicitly opted out of auth. The warden treats these differently.

### The Permit type

```typescript
interface Permit {
  readonly id: string;
  readonly scopes: readonly string[];
  readonly roles?: readonly string[];
  readonly tenantId?: string;
  readonly metadata?: Record<string, unknown>;
}
```

Core enforcement keys off `scopes` only. Roles are adapter output — the auth adapter resolves them, and implementations can read them, but the framework's own enforcement doesn't branch on roles. `metadata` stays `Record<string, unknown>` for v1. No generic `Permit<T>` — the complexity isn't justified until concrete use cases demand it.

### `ctx.permit` is `Permit | undefined`

`undefined` means no permit declaration or public trail. `Permit` means auth succeeded. Failed auth never reaches the implementation — the auth layer short-circuits with `Result.err(AuthError)` before `run` executes.

This means implementations can trust `ctx.permit` structurally. If it's present, it's valid. No defensive checks inside domain logic.

### Three-part model: declaration + extraction + enforcement

The permit model separates into three distinct responsibilities:

1. **Trail declaration.** `permit: { scopes: ['entity:write'] }` on the spec. Declares what's required.
2. **Surface extraction.** Each surface normalizes raw credentials into `PermitExtractionInput`. No surface types cross into core.
3. **Auth layer.** A shared layer that checks `ctx.permit.scopes` against the trail's declared scopes. Same layer, every surface.

### Normalized extraction input

```typescript
interface PermitExtractionInput {
  readonly surface: 'http' | 'mcp' | 'cli';
  readonly bearerToken?: string;
  readonly sessionId?: string;
  readonly headers?: Headers;
  readonly requestId: string;
}
```

Surfaces do raw extraction — pulling tokens from headers, sessions, or environment. The auth adapter receives this normalized input and returns a `Permit` or an error. Core auth never imports `Request`, `McpSession`, or any surface-specific type.

### Auth adapter interface

```typescript
interface AuthAdapter {
  authenticate(
    credentials: AuthCredentials,
  ): Promise<Result<Permit | null, AuthError>>;
}
```

The port is deliberately narrow. No session management, no token refresh, no user lookup. Adapters can provide those as additional services outside the core interface. The framework needs exactly one capability: given credentials, produce a permit or an error.

### Auth layer re-checks on every invocation including follows

`ctx.follow()` doesn't bypass auth. If a parent trail follows a child that declares its own `permit`, the auth layer re-checks. Defense in depth — composition doesn't create privilege escalation paths.

The warden statically validates that parent trail scopes are a superset of children's scopes. If `user.delete` requires `user:write` and follows `audit.log` which requires `audit:write`, the parent must hold both. This is a compile-time guarantee, not a runtime hope.

### Warden governance

Four new rules:

- **`destroy` + no permit** — error. Destructive trails without auth requirements are a governance failure.
- **`write` + no permit** — warning, unless `permit: 'public'` is set. Explicit public opt-out silences the warning.
- **`read` + no permit** — no rule. Read trails are commonly public.
- **Scope naming consistency** — warning for scope strings that don't follow the `entity:action` convention used by other trails in the topo.
- **Orphan scope detection** — warning for scopes not used by any other trail. Catches typos like `user:wirte`.

### Testing: minimal synthetic permits

`testExamples` auto-mints permits with exactly the declared scopes. No admin permit, no wildcard. If a trail declares `permit: { scopes: ['user:write'] }`, the test context receives a permit with `scopes: ['user:write']` and nothing more.

Strict mode disables auto-minting entirely. Tests must provide explicit permits, which validates that the auth surface works end-to-end rather than being papered over by test conveniences.

### Adapter strategy

Built-in: JWT/JWKS verification, provider-agnostic. Validates tokens, extracts claims, maps to `Permit`. No provider lock-in.

First external adapter target: BetterAuth or Clerk, depending on which ships a cleaner token contract. OpenAuth later, once the adapter pattern is proven.

### Bearer-only for v1

No cookies. No session-based auth at the framework level. Session management via cookies is an adapter concern — a future adapter can extract session tokens from cookies and feed them into the same `PermitExtractionInput`. The core model doesn't change; only the extraction surface does.

## Consequences

### Positive

- **Auth requirements are part of the trail contract.** Visible, verifiable, introspectable. An agent can query a topo and see every trail's auth posture without reading implementation code.
- **Same auth layer works across all surfaces.** HTTP, MCP, CLI — one enforcement path. No surface-specific auth bugs.
- **Testing fails closed.** Auto-minted permits match declared scopes exactly. No silent privilege escalation in tests. Strict mode proves the full auth path.
- **Warden catches unprotected destructive trails before deployment.** The `destroy` + no permit rule is a structural guarantee, not a code review convention.

### Tradeoffs

- **Explicit scopes require more authoring than convention-derived.** Every trail that needs auth must declare its scopes. This is intentional — auth policy should be visible and authored, not inferred — but it's more work.
- **Bearer-only limits session-based auth patterns in v1.** Cookie-based session auth is deferred to adapters. Apps that need it will build extraction logic outside the core model.
- **`permit: 'public'` is another thing to learn.** The distinction between omitted and explicitly public adds a concept. The warden makes the distinction actionable rather than academic.

### What this does NOT decide

- **Cookie/session auth.** An adapter concern. The extraction input has the seam; the core model doesn't prescribe it.
- **Resource-level authorization.** "Can this user access *this specific* entity?" is an implementation concern. The permit model covers capability scopes, not resource ownership.
- **RBAC framework.** Role-based access control is an app-level pattern. `roles` on the Permit type is informational, not enforced by the framework.
- **Scope derivation helpers.** Convenience functions that suggest scopes from trail ID patterns may ship later. They won't replace explicit declaration — they'll accelerate authoring it.

## References

- [ADR-004: Intent as a First-Class Property](004-intent-as-first-class-property.md) — intent compounds with permit for governance; `destroy` + no permit is an error
- [ADR-009: Services as a First-Class Primitive](009-services.md) — auth adapter is a service; auth layer consumes it via `service.from(ctx)`
- [ADR-010: Trails-Native Infrastructure Pattern](010-infrastructure-services-pattern.md) — auth layer follows the shared layer model for cross-cutting enforcement
