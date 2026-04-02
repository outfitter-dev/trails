---
id: 12
slug: connector-agnostic-permits
title: Connector-Agnostic Permits
status: accepted
created: 2026-03-30
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0012: Connector-Agnostic Permits

## Context

### The vocabulary is already reserved

`ctx.permit` exists on `TrailContext` typed as `unknown`. The name is claimed. The question isn't whether auth belongs on the context — it's how to structure the type, how trailheads populate it, and how the framework enforces it.

### Trailheads resolve auth differently

HTTP reads a bearer token from the `Authorization` header. MCP receives a session token from the transport handshake. CLI might pull credentials from a keyring or environment variable. Each trailhead has its own extraction mechanism, but the trail implementation shouldn't know or care which one ran. The implementation needs a single, trailhead-agnostic permit — or the knowledge that no permit was required.

### Auth is a provision + gate hybrid

Auth doesn't fit cleanly into one primitive. The auth provider (JWT verification, external identity service) is a service — it has lifecycle, configuration, and state. But enforcement is a layer — it wraps execution, short-circuits on failure, and runs on every invocation. The permit model needs to account for both halves without forcing them into one shape.

### Intent compounds with auth

A `destroy` trail with no auth requirement is a governance problem. Intent already tells the framework how dangerous a trail is (ADR-0004). Permit declarations tell it who's allowed to trigger that danger. The two fields compound: the warden can flag unprotected destructive trails before deployment, not after an incident.

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

Core enforcement keys off `scopes` only. Roles are connector output — the auth connector resolves them, and implementations can read them, but the framework's own enforcement doesn't branch on roles. `metadata` stays `Record<string, unknown>` for v1. No generic `Permit<T>` — the complexity isn't justified until concrete use cases demand it.

### `ctx.permit` is `Permit | undefined`

`undefined` means no permit declaration or public trail. `Permit` means auth succeeded. Failed auth never reaches the implementation — the auth layer short-circuits with `Result.err(AuthError)` before `run` executes.

This means implementations can trust `ctx.permit` structurally. If it's present, it's valid. No defensive checks inside domain logic.

### Three-part model: declaration + extraction + enforcement

The permit model separates into three distinct responsibilities:

1. **Trail declaration.** `permit: { scopes: ['entity:write'] }` on the spec. Declares what's required.
2. **Trailhead extraction.** Each trailhead normalizes raw credentials into `PermitExtractionInput`. No trailhead types cross into core.
3. **Auth gate.** A shared gate that checks `ctx.permit.scopes` against the trail's declared scopes. Same gate, every trailhead.

### Normalized extraction input

```typescript
interface PermitExtractionInput {
  readonly trailhead: 'http' | 'mcp' | 'cli';
  readonly bearerToken?: string;
  readonly sessionId?: string;
  readonly headers?: Headers;
  readonly requestId: string;
}
```

Trailheads do raw extraction — pulling tokens from headers, sessions, or environment. The auth connector receives this normalized input and returns a `Permit` or an error. Core auth never imports `Request`, `McpSession`, or any trailhead-specific type.

### Auth connector interface

```typescript
interface AuthConnector {
  authenticate(
    credentials: AuthCredentials,
  ): Promise<Result<Permit | null, AuthError>>;
}
```

The port is deliberately narrow. No session management, no token refresh, no user lookup. Connectors can provide those as additional services outside the core interface. The framework needs exactly one capability: given credentials, produce a permit or an error.

### Auth gate re-checks on every invocation including crosses

`ctx.cross()` doesn't bypass auth. If a parent trail crosses a child that declares its own `permit`, the auth gate re-checks. Defense in depth — composition doesn't create privilege escalation paths.

The warden statically validates that parent trail scopes are a superset of children's scopes. If `user.delete` requires `user:write` and crosses `audit.log` which requires `audit:write`, the parent must hold both. This is a compile-time guarantee, not a runtime hope.

### Warden governance

New rules by intent:

- **`destroy` + no permit** — error. Destructive trails without auth requirements are a governance failure.
- **`write` + no permit** — warning, unless `permit: 'public'` is set. Explicit public opt-out silences the warning.
- **`read` + no permit** — no finding. Read trails are commonly public.

New rules for scope hygiene:

- **Scope naming consistency** — warning for scope strings that don't follow the `entity:action` convention used by other trails in the topo.
- **Orphan scope detection** — warning for scopes not used by any other trail. Catches typos like `user:wirte`.

### Testing: minimal synthetic permits

`testExamples` auto-mints permits with exactly the declared scopes. No admin permit, no wildcard. If a trail declares `permit: { scopes: ['user:write'] }`, the test context receives a permit with `scopes: ['user:write']` and nothing more.

Strict mode disables auto-minting entirely. Tests must provide explicit permits, which validates that the auth trailhead works end-to-end rather than being papered over by test conveniences.

### Connector strategy

Built-in: JWT/JWKS verification, provider-agnostic. Validates tokens, extracts claims, maps to `Permit`. No provider lock-in.

First external connector target: BetterAuth or Clerk, depending on which ships a cleaner token contract. OpenAuth later, once the connector pattern is proven.

### Bearer-only for v1

No cookies. No session-based auth at the framework level. Session management via cookies is a connector concern — a future connector can extract session tokens from cookies and feed them into the same `PermitExtractionInput`. The core model doesn't change; only the extraction trailhead does.

## Consequences

### Positive

- **Auth requirements are part of the trail contract.** Visible, verifiable, introspectable. An agent can query a topo and see every trail's auth posture without reading implementation code.
- **Same auth gate works across all trailheads.** HTTP, MCP, CLI — one enforcement path. No trailhead-specific auth bugs.
- **Testing fails closed.** Auto-minted permits match declared scopes exactly. No silent privilege escalation in tests. Strict mode proves the full auth path.
- **Warden catches unprotected destructive trails before deployment.** The `destroy` + no permit rule is a structural guarantee, not a code review convention.

### Tradeoffs

- **Explicit scopes require more authoring than convention-derived.** Every trail that needs auth must declare its scopes. This is intentional — auth policy should be visible and authored, not inferred — but it's more work.
- **Bearer-only limits session-based auth patterns in v1.** Cookie-based session auth is deferred to connectors. Apps that need it will build extraction logic outside the core model.
- **`permit: 'public'` is another thing to learn.** The distinction between omitted and explicitly public adds a concept. The warden makes the distinction actionable rather than academic.

### What this does NOT decide

- **Cookie/session auth.** An connector concern. The extraction input has the seam; the core model doesn't prescribe it.
- **Resource-level authorization.** "Can this user access *this specific* entity?" is an implementation concern. The permit model covers capability scopes, not resource ownership.
- **RBAC framework.** Role-based access control is an app-level pattern. `roles` on the Permit type is informational, not enforced by the framework.
- **Scope derivation helpers.** Convenience functions that suggest scopes from trail ID patterns may ship later. They won't replace explicit declaration — they'll accelerate authoring it.

## References

- [ADR-0004: Intent as a First-Class Property](0004-intent-as-first-class-property.md) — intent compounds with permit for governance; `destroy` + no permit is an error
- [ADR-0009: Provisions as a First-Class Primitive](0009-first-class-provisions.md) — auth connector is a service; auth layer consumes it via `provision.from(ctx)`
- [ADR-0010: Trails-Native Infrastructure Pattern](0010-native-infrastructure.md) — auth layer follows the shared layer model for cross-cutting enforcement
