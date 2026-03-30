# Trails Code Patterns

## Run Functions

- Return `Result`, never throw. Use `Result.ok(value)` and `Result.err(new XError(...))`.
- Keep run functions surface-agnostic. No `process.exit()`, no `console.log()`, no `Request`/`Response`.
- Run functions receive `(input, ctx)` — validated input and `TrailContext`.
- Sync authoring is fine for pure work. The runtime normalizes to async.

## Composition

- Trails with `follow` compose through `ctx.follow()`, never by calling `.run()` directly.
- Declare `follow` on trails that compose others. The warden verifies these match actual `ctx.follow()` calls.
- Propagate errors: `if (result.isErr()) return result;`

## Schemas

- Use `.describe()` on every Zod field — it becomes `--help` text, MCP descriptions, and form labels.
- Every trail exposed on MCP or HTTP must define an `output` schema.
- Prefer the most specific `TrailsError` subclass available.

## Service Access

Declare infrastructure dependencies as services. Access them through `db.from(ctx)`.

```typescript
// Correct: declare and access via service definition
const search = trail('search', {
  services: [db],
  run: async (input, ctx) => {
    const conn = db.from(ctx);
    return Result.ok(await conn.search(input.query));
  },
});
```

Do not construct dependencies inline:

```typescript
// Wrong: inline construction hides dependencies, breaks testing
const search = trail('search', {
  run: async (input) => {
    const conn = openDatabase();       // invisible to framework
    try {
      return Result.ok(await conn.search(input.query));
    } finally {
      conn.close();                    // manual lifecycle
    }
  },
});
```

Service factories receive `ServiceContext` (env, cwd, workspaceRoot) — not the full `TrailContext`. Keep them surface-agnostic.

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
