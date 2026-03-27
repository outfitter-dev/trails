# Coding Conventions

Shared coding guidance for Trails packages and apps. Prefer the nearest repo and module conventions when a local file already establishes a stronger pattern.

## TSDoc

TSDoc explains the contract of exported APIs. Start there before reaching for inline comments or longer prose docs.

### When to Add TSDoc

- Add TSDoc to exported functions, classes, interfaces, and types that define package or surface boundaries.
- Add TSDoc to exported constants when their role or runtime behavior is not obvious from the name and type alone.
- Add `@example` blocks for APIs that are easier to understand from a concrete call site than from prose.
- Skip obvious one-line aliases and small internal helpers unless their intent is genuinely hard to infer.

### What Good TSDoc Covers

- Lead with one sentence describing what the API does, not how it is implemented.
- Document behavior the type system cannot express: defaults, invariants, ordering, side effects, and edge cases.
- Keep summaries tight. Prefer one sharp sentence over a paragraph.
- Prefer examples for non-obvious behavior.
- Do not restate parameter names or types in prose when the signature already says it clearly.

### Preferred Tags

- Use `@param` and `@returns` when exported function behavior is not trivial.
- Use `@remarks` for tradeoffs, lifecycle notes, or caveats that would clutter the summary.
- Use `@see` for closely related APIs.
- Avoid `@throws` for trail implementations. Document `Result` error shapes or relevant `TrailsError` types instead.

### Trails-Specific TSDoc

- Describe the contract a helper or surface exposes, especially derived names, validation boundaries, and `Result` behavior.
- For APIs that return `Result`, document the success shape and the error types callers should expect.
- Prefer examples that mirror how agents or surface adapters will actually consume the API.

## Code Shape Patterns

These patterns help keep code under the `max-statements` limit without normalizing suppressions. They also tend to produce code that is easier to test, extend, and read.

### Prefer Lookup Tables Over Switch Statements

When mapping a discriminant to behavior, use a `Record` lookup instead of a large switch:

```typescript
// Instead of this (6+ statements from cases alone):
switch (field.type) {
  case 'string':
    return text({ message: field.label });
  case 'number':
    return text({ message: field.label });
  case 'boolean':
    return confirm({ message: field.label });
  case 'enum':
    return select({ options: field.options });
  case 'multiselect':
    return multiselect({ options: field.options });
  default:
    return undefined;
}

// Do this (2 statements):
const promptByType: Record<Field['type'], (f: Field) => Promise<unknown>> = {
  boolean: (f) => confirm({ message: f.label }),
  enum: (f) => select({ message: f.label, options: f.options }),
  multiselect: (f) => multiselect({ message: f.label, options: f.options }),
  number: (f) => text({ message: f.label }),
  string: (f) => text({ message: f.label }),
};

const handler = promptByType[field.type];
return handler(field);
```

Each handler stays focused. Adding a new type becomes a new entry, not a new branch inside a growing function.

### Group Tests By Concern

Use nested `describe()` blocks to organize tests by behavior rather than building one long flat suite:

```typescript
// Instead of one describe with 12 tests:
describe('derive', () => {
  test('string field', ...);
  test('number field', ...);
  test('boolean field', ...);
  // ... 9 more
});

// Group by concern:
describe('derive', () => {
  describe('primitive types', () => {
    test('string field', ...);
    test('number field', ...);
    test('boolean field', ...);
  });

  describe('enum and multiselect', () => {
    test('enum with options', ...);
    test('array of enum becomes multiselect', ...);
  });

  describe('modifiers', () => {
    test('describe sets label', ...);
    test('default sets value', ...);
    test('optional marks not required', ...);
  });
});
```

### Collect Work Before Executing I/O

Separate deciding what to write from actually writing it:

```typescript
// Instead of sequential writes (10+ statements):
await Bun.write(join(dir, 'package.json'), content1);
await Bun.write(join(dir, 'tsconfig.json'), content2);
await Bun.write(join(dir, 'src/app.ts'), content3);
// ... 7 more

// Collect first, write once:
const files = new Map([
  ['package.json', generatePackageJson(options)],
  ['tsconfig.json', TSCONFIG_CONTENT],
  ['src/app.ts', generateApp(options)],
]);

const writeFiles = async (dir: string, files: Map<string, string>) => {
  for (const [relativePath, content] of files) {
    const fullPath = join(dir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await Bun.write(fullPath, content);
  }
};
```

This keeps the generation logic composable and the filesystem boundary small.

### Prefer Guard Clauses Over Nesting

Guard clauses reduce indentation, lower statement count, and make the control flow easier to scan:

```typescript
// Instead of nested conditions:
const processField = (field: Field, provided: Record<string, unknown>) => {
  if (field.required) {
    if (provided[field.name] === undefined) {
      if (field.default === undefined) {
        return prompt(field);
      }
    }
  }
  return provided[field.name];
};

// Guard and return early:
const processField = (field: Field, provided: Record<string, unknown>) => {
  if (!field.required) return provided[field.name];
  if (provided[field.name] !== undefined) return provided[field.name];
  if (field.default !== undefined) return field.default;
  return prompt(field);
};
```

## Bun-Native Defaults

Trails is Bun-native. Use Bun APIs where they improve the developer experience and keep compatibility concerns at the surface boundary.

- Use `Bun.file()` and `Bun.write()` for file I/O.
- Use `Bun.Glob` for discovery.
- Use `Bun.randomUUIDv7()` for sortable IDs.
- Use `Bun.CryptoHasher` for hashing.
- Use `Bun.spawn()` for subprocesses.
- Use `bun:sqlite` for storage.
- Use `node:fs` or `node:fs/promises` for capabilities Bun intentionally mirrors there, such as directory creation or recursive directory reads.
