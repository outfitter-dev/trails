import { describe, expect, test } from 'bun:test';

import { examplesMatchSchema } from '../rules/examples-match-schema.js';

describe('examples-match-schema', () => {
  test('flags examples missing required input keys', () => {
    const code = `
trail("entity.show", {
  input: z.object({ id: z.string(), name: z.string().optional() }),
  output: z.object({ id: z.string(), name: z.string() }),
  examples: [
    {
      name: "missing id",
      input: { name: "Alpha" },
      expected: { id: "1", name: "Alpha" },
    },
  ],
  implementation: (input) => Result.ok(input),
})`;

    const diagnostics = examplesMatchSchema.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('examples-match-schema');
    expect(diagnostics[0]?.message).toContain('required input key "id"');
  });

  test('flags examples missing required expected keys', () => {
    const code = `
trail("entity.show", {
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  examples: [
    {
      name: "missing output key",
      input: { id: "1" },
      expected: { id: "1" },
    },
  ],
  implementation: (input) => Result.ok(input),
})`;

    const diagnostics = examplesMatchSchema.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('required expected key "name"');
  });

  test('allows schema-only and error examples', () => {
    const code = `
trail("entity.show", {
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  examples: [
    { name: "schema only", input: { id: "1" } },
    { name: "error path", input: { id: "missing" }, error: "NotFoundError" },
  ],
  implementation: (input) => Result.ok(input),
})`;

    const diagnostics = examplesMatchSchema.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('flags examples that omit input entirely', () => {
    const code = `
trail("entity.show", {
  input: z.object({ id: z.string() }),
  examples: [{ name: "broken example" }],
  implementation: (input) => Result.ok(input),
})`;

    const diagnostics = examplesMatchSchema.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('missing an input object');
  });
});
