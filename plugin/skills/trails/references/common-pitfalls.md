# Common Pitfalls

## 1. Throwing in implementations

**Symptom:** Unhandled exception crashes the trailhead connector. Stack trace instead of structured error.

**Why it's wrong:** Trail implementations must return `Result`, never throw. Trailheads expect `Result.ok` or `Result.err` — a thrown exception bypasses error mapping, exit codes, and serialization.

**Fix:** Wrap risky code with try/catch and return `Result.err`:

```typescript
blaze: async (input) => {
  try {
    const data = await fetchExternal(input.url);
    return Result.ok(data);
  } catch (e) {
    return Result.err(new InternalError(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}
```

## 2. Importing trailhead types

**Symptom:** Implementation depends on `Request`, `Response`, `McpSession`, or `process`.

**Why it's wrong:** Implementations must be trailhead-agnostic. Importing trailhead types couples logic to a specific transport and breaks portability.

**Fix:** Keep implementations pure: `(input, ctx) => Result`. Access trailhead-specific features through `ctx` only.

## 3. Calling .run() directly

**Symptom:** Tests or composite trails call `myTrail.run(input)` and skip validation, gates, and tracing.

**Why it's wrong:** Direct calls bypass the framework pipeline. Input isn't validated, gates don't run, and traces aren't recorded.

**Fix:** In composite trails, use `ctx.cross('trail.id', input)` (pass the string ID, not the trail object). In tests, use `testAll()` or the test harness.

## 4. Missing output schema

**Symptom:** MCP trailhead rejects the trail. HTTP trailhead returns untyped JSON.

**Why it's wrong:** MCP and HTTP trailheads require output schemas to generate tool descriptions and validate responses.

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

## 6. Mismatched cross

**Symptom:** Warden reports "declared cross not called" or "undeclared cross detected".

**Why it's wrong:** A trail's `crosses` array must match the actual `ctx.cross()` calls. The warden enforces this to prevent undeclared dependencies and dead declarations.

**Fix:** Keep `crosses` in sync with implementation. If you add or remove a `ctx.cross()` call, update `crosses`:

```typescript
trail('onboard', {
  crosses: ['user.create', 'user.welcome'], // must match ctx.cross() calls
  blaze: async (input, ctx) => {
    const user = await ctx.cross('user.create', input);
    if (user.isErr()) return user;
    return ctx.cross('user.welcome', { userId: user.value.id });
  },
});
```

## 7. Using console.log for debugging

**Symptom:** Debug output interleaved with CLI formatted output. JSON output corrupted.

**Why it's wrong:** `console.log` writes to stdout, which CLI trailheads own for structured output. It breaks JSON mode, table formatting, and piped output.

**Fix:** Use `ctx.logger` for debug output:

```typescript
blaze: async (input, ctx) => {
  ctx.logger.debug('Processing', { input });
  // ...
}
```

## 8. Not propagating errors in composite trails

**Symptom:** Composite trail continues after a failed cross, producing confusing downstream errors.

**Why it's wrong:** Each `ctx.cross()` returns a `Result`. Ignoring the error means operating on undefined data.

**Fix:** Always check and propagate: `if (result.isErr()) return result;`

## 9. Constructing dependencies inline instead of declaring resources

**Symptom:** Every trail creates its own database connection. Tests require `vi.mock()`. `testAll(app)` fails for any trail with external dependencies.

**Why it's wrong:** Inline construction hides dependencies from the framework. The warden can't verify them, survey can't report them, and the testing harness can't swap them.

**Fix:** Define a `resource()`, declare it on the trail, and access with `db.from(ctx)`:

```typescript
// Define once
const db = resource('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  mock: () => createInMemoryDb(),
});

// Declare and access
const search = trail('search', {
  resources: [db],
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    // ...
  },
});
```

## 10. Forgetting mock factories on resource definitions

**Symptom:** `testAll(app)` fails with a resource resolution error because `DATABASE_URL` is not set in the test environment.

**Why it's wrong:** Without a `mock` factory, the testing harness falls back to the real `create` factory, which needs production-like configuration.

**Fix:** Always define `mock` on resource definitions:

```typescript
const db = resource('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  mock: () => createInMemoryDb(), // enables zero-config testAll(app)
});
```

## 11. Importing trailhead types into resource factories

**Symptom:** A resource factory imports `Request`, `McpSession`, or reads `process.argv`. It works on one trailhead but breaks on others.

**Why it's wrong:** Resource factories receive `ResourceContext` — a narrow subset with `env`, `cwd`, and `workspaceRoot` only. Resources are singletons resolved once per process, not per request. Trailhead-specific state would be stale after the first resolution.

**Fix:** Keep resource factories trailhead-agnostic. Use `svc.env` for configuration:

```typescript
const api = resource('api.client', {
  create: (svc) => Result.ok(new ApiClient(svc.env?.API_BASE_URL)),
  // Not this: create: (svc) => new ApiClient(process.argv[2])
});
```

## 12. Sync Result assumptions

**Symptom:** Test expects synchronous execution but gets a pending Promise.

**Why it's wrong:** Even synchronous implementations are awaited at runtime. The framework wraps all implementations uniformly.

**Fix:** Always `await` trail results in tests. Use `testTrail(myTrail, input)` instead of calling `.run()` directly.
