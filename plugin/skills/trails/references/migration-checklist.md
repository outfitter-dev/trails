# Migration Checklist

Detailed checklist for converting an existing codebase to Trails.

## Phase 1: Assessment

- [ ] Identify all request handlers (routes, CLI commands, MCP tools)
- [ ] Categorize each: trail candidate, layer candidate, signal candidate, or not applicable
- [ ] Map the dependency graph — which handlers call other handlers?
- [ ] Identify shared types and schemas that can be reused

## Phase 2: Schema Extraction

For each trail candidate:

- [ ] Define Zod input schema
  - [ ] Every field has `.describe('...')`
  - [ ] Optional fields use `.default()` or `.optional()`
  - [ ] Enums use `z.enum([...])` for CLI choices
  - [ ] Arrays have `.default([])` when empty is valid
- [ ] Define Zod output schema
  - [ ] Matches what the implementation actually returns
  - [ ] Required for any trail exposed on MCP or HTTP
- [ ] Identify shared schemas (entity shapes used across multiple trails)

## Phase 3: Implementation Conversion

For each handler:

- [ ] Create `trail()` definition (use `crosses:` for composition)
- [ ] Choose appropriate ID with dotted namespacing
- [ ] Set flags: `intent`, `idempotent`
- [ ] Move business logic to `blaze`
- [ ] Replace all `throw` with `Result.err(new XError(...))`
  - `throw new Error('not found')` → `Result.err(new NotFoundError(...))`
  - `throw new Error('already exists')` → `Result.err(new AlreadyExistsError(...))`
  - `throw new Error('unauthorized')` → `Result.err(new AuthError(...))`
  - `throw new Error('forbidden')` → `Result.err(new PermissionError(...))`
  - `throw new Error('invalid')` → `Result.err(new ValidationError(...))`
- [ ] Replace surface-specific returns with `Result.ok(value)`
  - `res.json(data)` → `Result.ok(data)`
  - `console.log(output)` → `Result.ok(output)`
  - `process.exit(1)` → `Result.err(new InternalError(...))`
- [ ] Remove surface imports from implementation files
- [ ] Convert handler-to-handler calls to `ctx.cross()` in composite trails

## Phase 4: Composition

- [ ] Create topo: `topo('appname', ...modules)`
- [ ] Open CLI surface: `await surface(graph)` from `@ontrails/cli/commander`
- [ ] Open MCP surface: `await surface(graph)` from `@ontrails/mcp`
- [ ] Remove old routing/command setup code

## Phase 5: Testing

- [ ] Add examples to every trail (happy path + key error cases)
- [ ] Create `governance.test.ts` with `testAll(graph)`
- [ ] Add edge-case tests with `testTrail()` for complex trails
- [ ] Add surface integration tests with CLI/MCP harnesses
- [ ] All tests pass

## Phase 6: Governance

- [ ] `trails warden` reports clean
- [ ] Regenerate topo artifacts: `trails topo compile`
- [ ] Verify topo artifacts: `trails topo verify`
- [ ] Add lock check to CI

## Common Gotchas

- **Async handlers**: Trails normalizes sync and async — both work. But `ctx.cross()` is always async.
- **Layers**: Convert to Layers, not trails. Layers wrap trail execution.
- **Error handling layers**: Remove them. Trails maps errors to exit codes/HTTP status automatically.
- **Response formatting**: Remove it. Use `outputModePreset()` for CLI, MCP handles it automatically.
