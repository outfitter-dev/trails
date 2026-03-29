# Trail Contract Patterns

Deep reference for trail contract authoring. For the quick overview, see the parent skill.

## Trail ID Naming

IDs are lowercase, dotted, verb-last. The namespace groups related operations; the final segment is the action.

```text
entity.show       # read one
entity.add        # create one
entity.list       # read many
entity.delete     # remove one
entity.archive    # soft-delete
search            # top-level (no namespace needed)
config.validate   # namespace.verb
```

**Rules:**

- Lowercase only. No camelCase, no PascalCase.
- Dots for namespacing. Two segments is typical; three is the max.
- Verb-last: `entity.show` not `show.entity`.
- Use hyphens for multi-word verbs: `math.add-and-double`.
- CLI mapping: dots become subcommands (`myapp entity show`).
- MCP mapping: dots become underscores (`entity_show`).

## Shared Schemas

Define schemas once, reuse across trails in the same module.

```typescript
// Full entity for detail views
const entitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Summary for list views — fewer fields, lighter payload
const entitySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
});
```

**Patterns:**

- **Entity vs summary:** Full schema for `.show`, summary for `.list`. Lists return arrays of summaries.
- **Enums:** Use `z.enum()` for known value sets. It generates `--choices` on CLI.
- **Array defaults:** Always `.default([])` on optional arrays to avoid null checks.
- **Pagination:** Standardize with `limit`/`offset` fields, both `.optional().default(...)`.

## Example Authoring

Examples serve three roles: agent documentation, test cases, and API specification.

### Structure

```typescript
examples: [
  {
    name: 'Descriptive test name',           // Required — shown in test output
    description: 'Agent-facing context',      // Optional — helps agents understand when to use
    input: { name: 'Alpha' },                 // Required — must validate against input schema
    expected: { id: '1', name: 'Alpha' },     // Full match — deep equals
  },
  {
    name: 'Schema validation only',
    input: { limit: 20, offset: 0 },          // No expected, no error — validates output schema
  },
  {
    name: 'Error path',
    input: { name: 'nonexistent' },
    error: 'NotFoundError',                   // Error match — asserts error type name
  },
],
```

### Guidelines

- **Name every example.** Names appear in test output and agent tool descriptions.
- **Realistic data.** Use `'Alpha'`, `'automation'`, `'pattern'` — not `'test'`, `'foo'`, `'bar'`.
- **Cover at minimum:** one happy path, one key error path.
- **Description is optional** but valuable for agents — explain *when* this scenario applies.
- **Order matters for docs:** put the primary happy path first, error cases last.
- **Keep inputs minimal.** Only include fields that matter for the scenario. Let defaults handle the rest.

## Intent and Flags

`intent` declares the trail's safety posture. `idempotent` is a separate boolean flag.

| Field | Value | When to use |
|-------|-------|-------------|
| `intent` | `'read'` | Pure reads, lookups, searches. No state changes. |
| `intent` | `'destroy'` | Deletes, irreversible mutations. CLI adds `--dry-run`. |
| `idempotent` | `true` | Safe to retry. Upserts, PUT-style operations. |

Omitting `intent` means "has side effects but not destructive" — typical for create/update. Surface effects: CLI adds `--dry-run` for `intent: 'destroy'`; MCP skips confirmation for `intent: 'read'`; HTTP maps `'read'` to GET, others to POST.

## Detours

Error recovery paths — what to suggest when a trail fails.

```typescript
detours: {
  NotFoundError: ['search'],           // Suggest search when entity isn't found
  ValidationError: ['entity.list'],    // Suggest listing when input is wrong
},
```

Keys are error type names (strings, not classes). Values are arrays of trail IDs. Surfaces can auto-suggest or auto-follow detours.

## Field Overrides

Per-field presentation customization. Optional — `.describe()` is usually sufficient.

```typescript
fields: {
  name: { label: 'Entity Name', hint: 'Case-sensitive match' },
  type: { options: ['concept', 'tool', 'pattern'] },  // Alternative to z.enum
},
```

## Composition Patterns

Trails that compose others use `follow` and `ctx.follow()`.

**`follow`** — declare which trails this trail composes. The warden verifies these match actual `ctx.follow()` calls: `follow: ['entity.add', 'search']`.

**`ctx.follow()`** — compose at runtime. Always `await`, always check `isErr()` before accessing `.value`, never call `.run()` directly. Type the generic for return shape: `ctx.follow<OutputType>(...)`.

```typescript
const result = await ctx.follow('entity.add', { name: 'Beta', type: 'tool' });
if (result.isErr()) return result;
