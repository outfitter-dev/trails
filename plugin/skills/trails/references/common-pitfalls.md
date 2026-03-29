# Common Pitfalls

## 1. Throwing in implementations

**Symptom:** Unhandled exception crashes the surface adapter. Stack trace instead of structured error.

**Why it's wrong:** Trail implementations must return `Result`, never throw. Surfaces expect `Result.ok` or `Result.err` — a thrown exception bypasses error mapping, exit codes, and serialization.

**Fix:** Wrap risky code with try/catch and return `Result.err`:

```typescript
run: async (input) => {
  try {
    const data = await fetchExternal(input.url);
    return Result.ok(data);
  } catch (e) {
    return Result.err(new InternalError(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}
```

## 2. Importing surface types

**Symptom:** Implementation depends on `Request`, `Response`, `McpSession`, or `process`.

**Why it's wrong:** Implementations must be surface-agnostic. Importing surface types couples logic to a specific transport and breaks portability.

**Fix:** Keep implementations pure: `(input, ctx) => Result`. Access surface-specific features through `ctx` only.

## 3. Calling .run() directly

**Symptom:** Tests or composite trails call `myTrail.run(input)` and skip validation, layers, and tracing.

**Why it's wrong:** Direct calls bypass the framework pipeline. Input isn't validated, layers don't run, and traces aren't recorded.

**Fix:** In composite trails, use `ctx.follow(myTrail, input)`. In tests, use `testAll()` or the test harness.

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

## 6. Mismatched follow

**Symptom:** Warden reports "declared follow not called" or "undeclared follow detected".

**Why it's wrong:** A trail's `follow` array must match the actual `ctx.follow()` calls. The warden enforces this to prevent undeclared dependencies and dead declarations.

**Fix:** Keep `follow` in sync with implementation. If you add or remove a `ctx.follow()` call, update `follow`:

```typescript
trail('onboard', {
  follow: [createUser, sendWelcome], // must match ctx.follow() calls
  run: async (input, ctx) => {
    const user = await ctx.follow(createUser, input);
    if (user.isErr()) return user;
    return ctx.follow(sendWelcome, { userId: user.value.id });
  },
});
```

## 7. Using console.log for debugging

**Symptom:** Debug output interleaved with CLI formatted output. JSON output corrupted.

**Why it's wrong:** `console.log` writes to stdout, which CLI surfaces own for structured output. It breaks JSON mode, table formatting, and piped output.

**Fix:** Use `ctx.logger` for debug output:

```typescript
run: async (input, ctx) => {
  ctx.logger.debug('Processing', { input });
  // ...
}
```

## 8. Not propagating errors in composite trails

**Symptom:** Composite trail continues after a failed follow, producing confusing downstream errors.

**Why it's wrong:** Each `ctx.follow()` returns a `Result`. Ignoring the error means operating on undefined data.

**Fix:** Always check and propagate: `if (result.isErr()) return result;`

## 9. Sync Result assumptions

**Symptom:** Test expects synchronous execution but gets a pending Promise.

**Why it's wrong:** Even synchronous implementations are awaited at runtime. The framework wraps all implementations uniformly.

**Fix:** Always `await` trail results in tests. Use `testTrail(myTrail, input)` instead of calling `.run()` directly.
