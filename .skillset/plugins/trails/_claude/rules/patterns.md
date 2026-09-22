# Trails Code Patterns

## Implementations

- Return `Result`, never throw. Use `Result.ok(value)` and `Result.err(new XError(...))`.
- Keep the implementation surface-agnostic. No `process.exit()`, no `console.log()`, no `Request`/`Response`.
- A implementation receives `(input, ctx)` — validated input and `TrailContext`.
- Sync authoring is fine for pure work. The runtime normalizes to async.

## Composition

- Trails with `composes` compose through `ctx.compose()`, never by calling `.implementation()` directly.
- Declare `composes` on trails that compose others. The warden verifies these match actual `ctx.compose()` calls.
- Propagate errors: `if (result.isErr()) return result;`

## Schemas

- Use `.describe()` on every Zod field — it becomes `--help` text, MCP descriptions, and form labels.
- Every trail exposed on MCP or HTTP must define an `output` schema.
- Prefer the most specific `TrailsError` subclass available.

## Resource Access

Declare infrastructure dependencies as resources. Access them through `db.from(ctx)`.

```typescript
// Correct: declare and access via resource definition
const search = trail('search', {
  resources: [db],
  implementation: async (input, ctx) => {
    const conn = db.from(ctx);
    return Result.ok(await conn.search(input.query));
  },
});
```

Do not construct dependencies inline:

```typescript
// Wrong: inline construction hides dependencies, breaks testing
const search = trail('search', {
  implementation: async (input) => {
    const conn = openDatabase();       // invisible to framework
    try {
      return Result.ok(await conn.search(input.query));
    } finally {
      conn.close();                    // manual lifecycle
    }
  },
});
```

Resource factories receive `ResourceContext` (env, cwd, workspaceRoot, and validated config when declared) — not the full `TrailContext`. Keep them surface-agnostic. Use `mock` for zero-config tests, or `unmockable: { reason }` when a live dependency cannot be safely mocked.

## Code Shape

- Prefer lookup tables over switch statements.
- Prefer guard clauses over nesting.
- Collect work before executing I/O.
- Group tests by concern with nested `describe()` blocks.

## Bun-Native

- `Bun.file()` / `Bun.write()` for file I/O
- `Bun.Glob` for discovery
- `Bun.randomUUIDv7()` for IDs
- `bun:test` for testing
