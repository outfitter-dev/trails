# @ontrails/permits

Scope-based authorization for Trails.

The permits package owns the connector-agnostic `authProvision` and `authGate`. Connector packages bind those declarations to concrete auth logic, just like a trailhead connector binds a topo to CLI, MCP, or HTTP.

## The core pattern

### 1. Declare permit requirements on trails

```typescript
export const create = trail('gist.create', {
  permit: { scopes: ['gist:write'] },
  blaze: async (input, ctx) => {
    // authGate enforces scopes before blaze runs
    return Result.ok(newGist);
  },
});

export const search = trail('gist.search', {
  permit: 'public',
  blaze: async (input, ctx) => {
    // No authentication required
    return Result.ok(results);
  },
});
```

### 2. Register the auth gate

```typescript
import { authGate } from '@ontrails/permits';

export const app = topo('my-app', gistModule);
// Register authGate with your trailhead
```

The gate reads each trail's `permit` field:

- `'public'` or `undefined` — gate passes through
- `{ scopes: [...] }` — gate checks that `ctx.permit` contains all required scopes

### 3. Bind a connector at bootstrap

```typescript
import { createJwtConnector } from '@ontrails/permits/jwt';

const connector = createJwtConnector({
  secret: process.env.JWT_SECRET,
  issuer: 'https://auth.example.com',
  audience: 'api.example.com',
});
```

## Auth connectors

An auth connector authenticates requests and produces permits.

### Built-in: JWT connector

Verifies HS256-signed JWTs and extracts claims into permits:

```typescript
import { createJwtConnector } from '@ontrails/permits/jwt';

const connector = createJwtConnector({
  secret: 'your-hmac-secret',
  issuer: 'https://auth.example.com',
  audience: 'api.example.com',
  scopesClaim: 'scope',
  rolesClaim: 'roles',
});
```

### Custom connectors

Implement the `AuthConnector` interface:

```typescript
import type { AuthConnector, PermitExtractionInput, Permit } from '@ontrails/permits';

const myConnector: AuthConnector = {
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

Access the permit in your blaze:

```typescript
import { getPermit } from '@ontrails/permits';

const myTrail = trail('do.something', {
  blaze: async (_input, ctx) => {
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

Use `mintTestPermit()` and `mintPermitForTrail()` in tests:

```typescript
import { mintTestPermit, mintPermitForTrail } from '@ontrails/permits';

const permit = mintTestPermit({
  id: 'user-123',
  scopes: ['gist:read', 'gist:write'],
  roles: ['editor'],
});

// Mint a permit matching a trail's requirements
const trailPermit = mintPermitForTrail(myTrail);
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

```bash
bun add @ontrails/permits @ontrails/core zod
```
