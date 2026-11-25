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

The same options work in `authResource` configuration with `adapter: 'jwt'`. Existing `secret` configuration remains valid; custom permit producers still need the actor-shape migration described below. `requireExpiration: false` remains available for secret-backed tokens; issuer mode always requires expiration. The default clock tolerance for `exp` and `nbf` remains 60 seconds in both modes. Tokens are expired when `exp` equals the current time minus the tolerance; this corrects the previous HS256 boundary accepting equality. Issuer verification does not provide sign-in, token minting, or DPoP verification.

The JWT adapter accepts Bearer credentials only. A raw Authorization value with a Bearer scheme is selected before the normalized `bearerToken` candidate; malformed presented Bearer and selected empty tokens fail authentication rather than becoming anonymous access. An invalid selected Bearer is never rescued by an alternate API key or token. Other Authorization schemes are not JWT credentials. Existing normalized Bearer callers remain supported.

### Opaque tokens and API-key lookup

Use `createTokenCallbackAdapter` when verification delegates to a portable `kv` or `store` lookup, a provider API, or a Service Binding. The helper selects one credential before lookup and does not retry another source.

```typescript
import { Result } from '@ontrails/core';
import { createTokenCallbackAdapter } from '@ontrails/permits';

// keys is supplied by the app's portable kv/store resource, not a host SDK.
const adapter = createTokenCallbackAdapter({
  extractToken: input => input.apiKey,
  lookup: async token => Result.ok(await keys.get(token)),
});
```

This policy trusts only `x-api-key`. `undefined` means that source is absent, so lookup is skipped and authentication returns `Result.ok(null)`. A selected empty value, lookup miss (`Result.ok(null)` from `lookup`), or callback exception is an authentication error. Lookup errors remain errors. The selected bytes are preserved exactly; the helper never trims, decodes or applies JWT grammar. Both callbacks run at most once. An alternative candidate cannot rescue a failed selected credential. The original normalized input passed to `lookup` supports correlation and policy context, not another selection attempt.

`PermitExtractionInput` carries optional `apiKey` (`x-api-key`), `authToken` (`x-auth-token`), `authorization` (the raw Authorization value) and `bearerToken` candidates. Presence is not trust. The adapter explicitly chooses its accepted sources and syntax, including whether raw Authorization is an API key. An extractor must return an error sentinel (`''`) for its selected malformed source rather than treating it as absent. Credentials are never read from query strings. Custom `AuthAdapter` implementations remain available for richer extraction policies; once a credential is selected, failure must return an error.

Static API keys are supported as a fallback. Prefer exchanging them for short-lived tokens at the provider. An organization key identifies the organization in `Permit.id`; do not invent a person identity for it. Scope intersection with current roles and actor ceilings is separate work.

For surface integration, `resolvePermitFromInput` uses the existing auth resource lookup, materialization and runtime permit validation, returning `BasePermit | null`. `resolvePermitFromBearerToken` retains its strict contract: an adapter's null outcome is a missing-credentials error. Register the callback adapter through the existing auth resource override or an app-owned resource factory; function callbacks are not serialized into resource config or a lock.

Resource config uses the existing Config `env`/`secret` annotations for actual secret fields. Keep secret names in declaration metadata and values out of committed artifacts; do not add an API-key pepper unless the chosen lookup uses one. Profile derivation and deployment rendering remain owned by their deploy integration and are not provided by the callback helper.

### Custom adapters

Implement the `AuthAdapter` interface:

```typescript
import type { AuthAdapter, PermitExtractionInput, Permit } from '@ontrails/permits';

const myAdapter: AuthAdapter = {
  authenticate: async (input: PermitExtractionInput) => {
    if (!input.bearerToken) return Result.ok(null);
    const permit: Permit = {
      actors: [],
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
interface PermitActor {
  readonly id: string;
  readonly issuer?: string;
  readonly kind: string;
  readonly verified: boolean;
}

interface PermitAdmission {
  readonly by: string;
  readonly kind: 'verified' | 'asserted' | 'synthetic';
}

interface Permit {
  readonly actors: readonly PermitActor[];
  readonly admission?: PermitAdmission;
  readonly expiresAt?: number;
  readonly issuer?: string;
  readonly id: string;
  readonly scopes: readonly string[];
  readonly roles?: readonly string[];
  readonly tenantId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
```

Every execution permit requires an explicit `actors` array. `[]` means the trusted author has no known acting-party evidence; validation never fills it in. `issuer` identifies the permit attester, while each actor's optional `issuer` identifies that actor's namespace. Preserve exact strings and leave unknown namespaces absent. `expiresAt` is a finite Unix epoch timestamp in milliseconds; absence means unknown. Core validates the permit shape before execution, including public trails, but does not enforce this deadline or actor policy.

The stock JWT adapter retains validated `iss` and converts `exp` from seconds to milliseconds once, without adding clock tolerance. It maps an `act` chain current-first, then nearest-to-oldest history. An actor needs nonempty `sub`; explicit `iss` and `kind` are retained, and absent `kind` becomes `unknown`. `kind` is a Trails/provider extension. Every mapped actor has `verified: true` from credential validation; an `act.verified` claim never supplies provenance. Historical actors are audit evidence.

Without `act`, nonempty `client_id` or `azp` produces one `client` actor. When both appear they must match exactly. With `act`, valid client aliases do not replace or append to the acting-party chain. Malformed recognized client claim types are rejected in either case. The stock mapper leaves client actor issuer absent because a token attester alone does not establish the client's identity namespace. Custom adapters own their explicit evidence mapping.

Use `derivePermitIdentityKey(permit)` when subject identity crosses issuer boundaries. It returns `Result<string, ValidationError>` and encodes the exact tuple `[issuer, id, tenantId ?? null]`. Issuerless permits remain valid for local execution, but this helper rejects them. Do not substitute bare subjects, email addresses, or invented local issuers in global routing or shared persistence. Actor identities are separate from this subject key. See the [migration guide](../../docs/migration/permit-identity.md) for custom adapters and stored trace compatibility.

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

## One door: reconciling credential candidates

A permit enters the pipeline only through a surface's credential input. Each surface extracts what it found (an inline permit, a request for the synthetic development permit, a presented credential), names its posture, and hands the candidates to `reconcilePermit`. The reconciliation is the CLI's `--permit` / `--token` / `--dev-permit` logic lifted into this package so every surface shares one set of rules:

```typescript
import { reconcilePermit, resolvePermitFromInput } from '@ontrails/permits';

const result = await reconcilePermit({
  candidates: { credential: { bearerToken: token, label: '--token' } },
  graph,
  posture: 'in-process', // or 'network' for HTTP, Streamable HTTP MCP, WebSocket
  requestId,
  surface: 'cli',
  verifierName: 'auth',
  verify: (input) => resolvePermitFromInput({ ...input, graph }),
});
```

The outcomes are fixed:

- No candidate: `Result.ok(undefined)`. The surface decides what absence means. An in-process host keeps its seed; a network surface is anonymous.
- More than one candidate: `ValidationError` naming the labels (`--permit, --token are mutually exclusive; pass only one.`).
- A presented credential with no verifier: `ValidationError` in process, `AuthError` with `code: 'no_permit_resolver'` on the network. A verifier that returns `null` selected no credential, which is absence.
- `inline` and `synthetic` are asserted kinds. They are refused on the network posture (`asserted_kind_refused`) and admitted in process only under host policy. The policy is derived from the topo when the surface passes none: allowed while the app declares no `auth` resource, denied once one exists (`asserted_kind_disabled`). An explicit `AssertedKindsPolicy` from app config (never argv) can re-enable them with a `maxScopes` ceiling. The CLI exposes it as `assertedKinds` on `deriveCliCommands`.

Whatever the reconciliation admits carries `admission`: `verified` with the verifier's name, `asserted` or `synthetic` with the policy's name. Asserted kinds never carry a verified actor: an authored chain is downgraded to `verified: false`, and a host-supplied `actor` (the launching client) is recorded the same way, so ceilings and step-up see local agents without trusting the label. Only this reconciliation constructs `admission`; network surfaces accept only permits produced by their own resolver path, so the serialized value feeds tracing, ceilings and Warden rather than acting as a trust signal on its own.

## The auth.verify trail

An infrastructure trail that verifies bearer tokens and returns permits:

```typescript
import { authVerify } from '@ontrails/permits';

// Returns { valid: true, permit: { actors, id, scopes, roles, ... } }
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
// { actors: [], id: 'test-...', scopes: ['gist:write'] }
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
