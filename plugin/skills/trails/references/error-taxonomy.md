# Error Taxonomy Reference

## All 15 Error Classes

### validation (exit 1, HTTP 400)

- **ValidationError** — Input fails schema or business rules. `new ValidationError('age must be positive', { context: { field: 'age', value: -1 } })`
- **AmbiguousError** — Input matches multiple interpretations. `new AmbiguousError('name matches 3 users', { context: { candidates: ['alice', 'alex', 'ali'] } })`

### not_found (exit 2, HTTP 404)

- **NotFoundError** — Entity or resource not found. `new NotFoundError("User 'alice' not found", { context: { entity: 'User', id: 'alice' } })`

### conflict (exit 3, HTTP 409)

- **AlreadyExistsError** — Entity with that ID already exists. `new AlreadyExistsError("User 'alice' already exists", { context: { entity: 'User', id: 'alice' } })`
- **ConflictError** — State conflict (concurrent modification, version mismatch). `new ConflictError('version mismatch', { context: { expected: 3, actual: 5 } })`

### permission (exit 4, HTTP 403)

- **PermissionError** — Authenticated but not authorized. `new PermissionError('cannot delete admin users')`

### timeout (exit 5, HTTP 504)

- **TimeoutError** — Operation exceeded time limit. `new TimeoutError('API call timed out after 30s', { context: { timeoutMs: 30000 } })`

### rate_limit (exit 6, HTTP 429)

- **RateLimitError** — Too many requests. `new RateLimitError('rate limit exceeded', { retryAfter: 5000 })` (milliseconds)

### network (exit 7, HTTP 502)

- **NetworkError** — Upstream service unreachable. `new NetworkError('DNS resolution failed for api.example.com')`

### internal (exit 8, HTTP 500)

- **InternalError** — Unexpected failure. Catch-all for bugs. `new InternalError('unexpected null in pipeline')`
- **DerivationError** — Framework or projection derivation failure. `new DerivationError('could not derive CLI fields from schema')`
- **AssertionError** — Invariant violation. `new AssertionError('items array must not be empty after filter')`

### auth (exit 9, HTTP 401)

- **AuthError** — Not authenticated. Missing or invalid credentials. `new AuthError('API key expired')`

### cancelled (exit 130, HTTP 499)

- **CancelledError** — Operation cancelled by user or caller. `new CancelledError('user aborted')`

### wrapped category (exit and HTTP inherited, not retryable)

- **RetryExhaustedError** — Detour recovery exhausted. Inherits the wrapped `TrailsError` category for surface mappings and sets `retryable` to `false`. `new RetryExhaustedError(error, { attempts: 3, detour: 'NotFoundError' })`

## Pattern Matching

### By instance

```typescript
import { NotFoundError, ValidationError } from '@ontrails/core';

if (error instanceof NotFoundError) {
  // handle missing entity
} else if (error instanceof ValidationError) {
  // handle bad input
}
```

### By category

```typescript
switch (error.category) {
  case 'not_found': // ...
  case 'validation': // ...
  case 'network': // retry
}
```

### Type guard

```typescript
import { isTrailsError } from '@ontrails/core';

if (isTrailsError(value)) {
  console.log(value.category, value.message);
}
```

### Retryable check

```typescript
import { isRetryable } from '@ontrails/core';

if (isRetryable(error)) {
  // safe to retry — timeout, rate_limit, or network
}
```

## Serialization

Errors serialize cleanly for logging, transport, and persistence:

```typescript
import { serializeError, deserializeError } from '@ontrails/core';

const json = serializeError(error);
// { class: 'NotFoundError', category: 'not_found', message: '...', details: {...} }

const restored = deserializeError(json);
// Full TrailsError instance with correct prototype chain
```

## Error Composition in Composite Trails

Propagate upstream errors directly. Wrap only when adding context:

```typescript
// Propagate as-is (most common)
const result = await ctx.cross(lookupUser, { id });
if (result.isErr()) return result;

// Wrap when adding context (rare — only when upstream error would be misleading)
if (result.isErr()) {
  return Result.err(new InternalError(`Failed to load profile: ${result.error.message}`, { cause: result.error }));
}
```
