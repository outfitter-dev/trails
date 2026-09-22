# Common Pitfalls

## 1. Throwing in implementations

**Symptom:** Unhandled exception crashes the surface adapter. Stack trace instead of structured error.

**Why it's wrong:** Implementations must return `Result`, never throw. Surfaces expect `Result.ok` or `Result.err` — a thrown exception bypasses error mapping, exit codes, and serialization.

**Fix:** Wrap risky code with try/catch and return `Result.err`:

```typescript
implementation: async (input) => {
  try {
    const data = await fetchExternal(input.url);
    return Result.ok(data);
  } catch (e) {
    return Result.err(new InternalError(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}
```

## 2. Importing surface types

**Symptom:** The implementation depends on `Request`, `Response`, `McpSession`, or `process`.

**Why it's wrong:** Implementations must be surface-agnostic. Importing surface types couples logic to a specific surface and breaks portability.

**Fix:** Keep implementations pure: `(input, ctx) => Result`. Access surface-specific features through `ctx` only.

## 3. Calling .implementation() directly

**Symptom:** Tests or composite trails call `myTrail.implementation(input)` and skip validation, layers, and tracing.

**Why it's wrong:** Direct calls bypass the framework pipeline. Input isn't validated, layers don't run, and traces aren't recorded.

**Fix:** In composite trails, use `ctx.compose(targetTrail, input)` for typed calls or `ctx.compose('trail.id', input)` for string-id calls. In tests, use `testAll()`, `testTrail()`, or `testComposes()` from `@ontrails/testing`.

## 4. Missing output schema

**Symptom:** MCP surface rejects the trail. HTTP surface returns untyped JSON.

**Why it's wrong:** MCP and HTTP surfaces require output schemas to generate tool descriptions and validate responses.

**Fix:** Always define `output` in the trail definition:

```typescript
trail('users.list', {
  output: z.object({ users: z.array(userSchema) }),
  // ...
});
```

## 5. Forgetting .describe() on fields

**Symptom:** `--help` shows parameter names but no descriptions. MCP tool descriptions are bare.

**Why it's wrong:** Field descriptions become CLI help text, MCP tool parameter descriptions, and API documentation. Without them, consumers have to guess.

**Fix:** Add `.describe()` to every field:

```typescript
input: z.object({
  query: z.string().describe('Search term to match against names'),
  limit: z.number().default(10).describe('Maximum results to return'),
})
```

## 6. Mismatched compose

**Symptom:** Warden reports "declared compose not called" or "undeclared compose detected".

**Why it's wrong:** A trail's `composes` array must match the actual `ctx.compose()` calls. The warden enforces this to prevent undeclared dependencies and dead declarations.

**Fix:** Keep `composes` in sync with the implementation. If you add or remove a `ctx.compose()` call, update `composes`:

```typescript
import { trail } from '@ontrails/core';
import { userCreate } from './user-create.js';
import { userWelcome } from './user-welcome.js';

trail('onboard', {
  composes: [userCreate, userWelcome], // must match ctx.compose() calls
  implementation: async (input, ctx) => {
    const user = await ctx.compose(userCreate, input);
    if (user.isErr()) return user;
    return ctx.compose(userWelcome, { userId: user.value.id });
  },
});
```

## 7. Using console.log for debugging

**Symptom:** Debug output interleaved with CLI formatted output. JSON output corrupted.

**Why it's wrong:** `console.log` writes to stdout, which CLI surfaces own for structured output. It breaks JSON mode, table formatting, and piped output.

**Fix:** Use `ctx.logger` for debug output:

```typescript
implementation: async (input, ctx) => {
  ctx.logger?.debug('Processing', { input });
  // ...
}
```

## 8. Not propagating errors in composite trails

**Symptom:** Composite trail continues after a failed compose, producing confusing downstream errors.

**Why it's wrong:** Each `ctx.compose()` returns a `Result`. Ignoring the error means operating on undefined data.

**Fix:** Always check and propagate: `if (result.isErr()) return result;`

## 9. Constructing dependencies inline instead of declaring resources

**Symptom:** Every trail creates its own database connection. Tests require `vi.mock()`. `testAll(graph)` fails for any trail with external dependencies.

**Why it's wrong:** Inline construction hides dependencies from the framework. The warden can't verify them, survey can't report them, and the testing harness can't swap them.

**Fix:** Define a `resource()`, declare it on the trail, and access with `db.from(ctx)`:

```typescript
// Define once
const db = resource('db.main', {
  create: (resourceCtx) => Result.ok(openDatabase(resourceCtx.env?.DATABASE_URL)),
  mock: () => createInMemoryDb(),
});

// Declare and access
const search = trail('search', {
  resources: [db],
  implementation: async (input, ctx) => {
    const conn = db.from(ctx);
    // ...
  },
});
```

## 10. Forgetting mock factories on resource definitions

**Symptom:** `testAll(graph)` fails with a resource resolution error because `DATABASE_URL` is not set in the test environment.

**Why it's wrong:** Without a `mock` factory, the testing harness falls back to the real `create` factory, which needs production-like configuration.

**Fix:** Always define `mock` on resource definitions:

```typescript
const db = resource('db.main', {
  create: (resourceCtx) => Result.ok(openDatabase(resourceCtx.env?.DATABASE_URL)),
  mock: () => createInMemoryDb(), // enables zero-config testAll(graph)
});
```

## 11. Importing surface types into resource factories

**Symptom:** A resource factory imports `Request`, `McpSession`, or reads `process.argv`. It works on one surface but breaks on others.

**Why it's wrong:** Resource factories receive `ResourceContext` — a narrow subset with stable process-scoped fields (`env`, `cwd`, `workspaceRoot`, and validated `config` when the resource declares a config schema). Resources are singletons resolved once per process, not per request. Surface-specific state would be stale after the first resolution.

**Fix:** Keep resource factories surface-agnostic. Use `resourceCtx.config` for declared resource config or `resourceCtx.env` for one-off environment values:

```typescript
import { z } from 'zod';

const api = resource('api.client', {
  config: z.object({ baseUrl: z.string().url() }),
  create: (resourceCtx) => Result.ok(new ApiClient(resourceCtx.config.baseUrl)),
  // Not this: create: (resourceCtx) => new ApiClient(process.argv[2])
});
```

## 12. Sync Result assumptions

**Symptom:** Test expects synchronous execution but gets a pending Promise.

**Why it's wrong:** Even synchronous implementations are awaited at runtime. The framework normalizes all implementations uniformly.

**Fix:** Always `await` trail results in tests. Use `testTrail(myTrail, input)` instead of calling `.implementation()` directly.
