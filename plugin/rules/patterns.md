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
