# @ontrails/permits

Scope-based authorization for Trails.

The permits package owns adapter-agnostic auth resources, adapters, and helpers. Core `executeTrail` enforces trail `permit` declarations once a surface has resolved a permit into `ctx.permit`.

## The core pattern

### 1. Declare permit requirements on trails

```typescript
export const create = trail('gist.create', {
  permit: { scopes: ['gist:write'] },
  implementation: async (input, ctx) => {
    // executeTrail enforces scopes before execution enters the implementation
    return Result.ok(newGist);
  },
});

export const search = trail('gist.search', {
  permit: 'public',
  implementation: async (input, ctx) => {
    // No authentication required
    return Result.ok(results);
  },
});
```

### 2. Resolve a permit at the surface

```typescript
export const graph = topo('my-app', gistModule);
// Surface auth verifies credentials and passes { permit } into executeTrail.
```

The execution pipeline reads each trail's `permit` field:

- `'public'` or `undefined` — execution passes through
- `{ scopes: [...] }` — execution checks that `ctx.permit` contains all required scopes

Permit enforcement is intrinsic to `executeTrail`; there is no opt-in layer to wire. The previously deprecated `authLayer` compatibility wrapper has been removed (TRL-475).

### 3. Bind an adapter at bootstrap

```typescript
import { createJwtAdapter } from '@ontrails/permits/jwt';

const adapter = createJwtAdapter({
  secret: process.env.JWT_SECRET,
  issuer: 'https://auth.example.com',
  audience: 'api.example.com',
});
```

## Auth adapters

An auth adapter authenticates requests and produces permits.

### Built-in: JWT adapter

Verifies JWTs and extracts claims into permits using native WebCrypto. A `secret` selects HS256. Without a secret, configure an `issuer` and expected `audience` for OIDC discovery and JWKS verification:

```typescript
import { createJwtAdapter } from '@ontrails/permits/jwt';

const adapter = createJwtAdapter({
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
  scopesClaim: 'scope',
  rolesClaim: 'roles',
});
```

Issuer mode supports RS256, ES256 (P-256), and EdDSA (Ed25519). It checks the configured issuer and audience, requires `exp`, and validates `nbf` when present. The audience is the token's intended recipient; configure it separately from any protected-resource URL. Subjects map to `Permit.id`, and scopes and roles use the configured claim names. String scopes are space-separated; scopes and roles can also be arrays. Workload identity tokens, including GitHub Actions OIDC tokens, use the same verification path and must have the expected audience.

Discovery requests `/.well-known/openid-configuration` below the issuer path. A 404 falls back to RFC 8414's `/.well-known/oauth-authorization-server` before the issuer path. Metadata must identify the exact configured issuer and supply `jwks_uri`. For providers without discovery, set `jwksUrl` alongside `issuer` and `audience`. Configure only trusted HTTPS endpoints. Token-supplied `jku` and `x5u` headers never select a key endpoint. Fetches reject redirects and time out after five seconds.

Discovery metadata, public keys, and imported verification keys are shared across adapter instances in the current process or isolate. Tokens, permits, and authorization decisions are never cached. The cache holds at most 32 issuer and JWKS endpoint combinations; metadata and key sets expire after five minutes. Concurrent refreshes share one load. An unknown `kid` can trigger a key refresh once per 30 seconds; an unknown key is rejected after refresh. Failed loads have a 30-second cooldown and expired keys are not used when refreshing fails. A new key introduced during the cooldown may be rejected until the next refresh; publish rotated keys before issuing tokens that use them. Tokens without `kid` require exactly one compatible verification key.

DPoP proofs and tokens containing a `cnf` confirmation claim are rejected: this adapter cannot verify sender binding. Unsupported critical JOSE extensions are also rejected. `allowedAlgorithms` can narrow the algorithms accepted within the selected mode; it cannot enable HS256 in issuer mode or asymmetric algorithms in secret mode.

Existing secret-backed configuration remains supported, including optional issuer and audience checks:

```typescript
import { createJwtAdapter } from '@ontrails/permits/jwt';

const adapter = createJwtAdapter({
  secret: 'your-hmac-secret',
  issuer: 'https://auth.example.com',
  audience: 'api.example.com',
  scopesClaim: 'scope',
  rolesClaim: 'roles',
});
```

`@ontrails/permits/jwt` is the canonical built-in JWT adapter subpath. The root package intentionally keeps convenience re-exports for interactive discovery, but generated code, docs, and adapter-specific examples should import JWT names from the subpath.

The same options work in `authResource` configuration with `adapter: 'jwt'`. Existing apps using `secret` need no migration. `requireExpiration: false` remains available for secret-backed tokens; issuer mode always requires expiration. The default clock tolerance for `exp` and `nbf` remains 60 seconds in both modes. Tokens are expired when `exp` equals the current time minus the tolerance; this corrects the previous HS256 boundary accepting equality. This addition keeps the existing `Permit` fields and does not provide sign-in, token minting, or DPoP verification.

### Custom adapters

Implement the `AuthAdapter` interface:

```typescript
import type { AuthAdapter, PermitExtractionInput, Permit } from '@ontrails/permits';

const myAdapter: AuthAdapter = {
  authenticate: async (input: PermitExtractionInput) => {
    if (!input.bearerToken) return Result.ok(null);
    const permit: Permit = {
      id: 'user-42',
      scopes: ['user:read', 'user:write'],
      roles: ['admin'],
    };
    return Result.ok(permit);
  },
};
```

## Permits and scopes

A `Permit` is the resolved identity and scopes from successful authentication:

```typescript
interface Permit {
  readonly id: string;
  readonly scopes: readonly string[];
  readonly roles?: readonly string[];
  readonly tenantId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
```

Access the permit in your implementation:

```typescript
import { getPermit } from '@ontrails/permits';

const myTrail = trail('do.something', {
  implementation: async (_input, ctx) => {
    const permit = getPermit(ctx);
    if (!permit) return Result.err(new Error('Not authenticated'));
    return Result.ok({ userId: permit.id });
  },
});
```

Scopes follow the `entity:action` convention: `user:read`, `gist:write`, etc.

## The auth.verify trail

An infrastructure trail that verifies bearer tokens and returns permits:

```typescript
import { authVerify } from '@ontrails/permits';

// Returns { valid: true, permit: { id, scopes, roles } }
// or { valid: false, error: 'Token has expired', errorCode: 'expired_token' }
```

## Testing with mock permits

Use `createTestPermit()` and `createPermitForTrail()` in tests:

```typescript
import {
  createTestPermit,
  createPermitForTrail,
} from '@ontrails/permits/testing';

const permit = createTestPermit({
  id: 'user-123',
  scopes: ['gist:read', 'gist:write'],
  roles: ['editor'],
});

// Create a permit matching a trail's requirements
const trailPermit = createPermitForTrail(myTrail);
// { id: 'test-...', scopes: ['gist:write'] }
```

## Permit governance

Use `validatePermits()` to check trails against governance rules:

```typescript
import { validatePermits } from '@ontrails/permits';

const diagnostics = validatePermits(app.list());
```

Built-in rules:

- `destroyWithoutPermit` — error if a destroy trail has no permit
- `writeWithoutPermit` — warning if a write trail has no permit
- `scopeNamingConsistency` — warning if a scope doesn't follow `entity:action`
- `orphanScopeDetection` — warning if a scope appears in only one trail

## Installation

These installation examples target Trails `0.2.1` on the normal npm release line.

```bash
bun add --exact @ontrails/permits@0.2.1 @ontrails/core@0.2.1 zod
```
