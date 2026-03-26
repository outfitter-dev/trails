import { describe, expect, test } from 'bun:test';

import { validDescribeRefs } from '../rules/valid-describe-refs.js';

describe('valid-describe-refs', () => {
  test('warns when a describe @see tag points to a missing trail', () => {
    const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe("Search query. @see entity.search"),
  }),
  implementation: (input) => Result.ok(input),
})`;

    const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('valid-describe-refs');
    expect(diagnostics[0]?.message).toContain('entity.search');
  });

  test('allows local @see references that resolve in the same file', () => {
    const code = `
trail("entity.search", {
  input: z.object({ query: z.string() }),
  implementation: (input) => Result.ok(input),
})

trail("entity.show", {
  input: z.object({
    query: z.string().describe("Search query. @see entity.search"),
  }),
  implementation: (input) => Result.ok(input),
})`;

    const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('uses project context for cross-file @see references', () => {
    const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe("Search query. @see entity.search"),
  }),
  implementation: (input) => Result.ok(input),
})`;

    const diagnostics = validDescribeRefs.checkWithContext(
      code,
      'src/entity.ts',
      {
        knownTrailIds: new Set(['entity.search', 'entity.show']),
      }
    );

    expect(diagnostics).toHaveLength(0);
  });
});
