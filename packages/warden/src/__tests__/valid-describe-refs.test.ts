import { describe, expect, test } from 'bun:test';

import { validDescribeRefs } from '../rules/valid-describe-refs.js';

describe('valid-describe-refs', () => {
  test('warns when a describe @see tag points to a missing trail', () => {
    const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe("Search query. @see entity.search"),
  }),
  blaze: (input) => Result.ok(input),
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
  blaze: (input) => Result.ok(input),
})

trail("entity.show", {
  input: z.object({
    query: z.string().describe("Search query. @see entity.search"),
  }),
  blaze: (input) => Result.ok(input),
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
  blaze: (input) => Result.ok(input),
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

  test('ignores @see tags embedded in unrelated string literals', () => {
    const code = `
const docs = "see also @see entity.ghost in the other doc";

trail("entity.show", {
  input: z.object({ query: z.string() }),
  blaze: (input) => Result.ok(input),
})`;

    const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores @see tags inside template-literal payloads that mimic describe calls', () => {
    const code = `
const example = \`
trail("entity.show", {
  input: z.object({
    query: z.string().describe("@see entity.ghost"),
  }),
})\`;
`;

    const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('flags @see tags inside template-literal describe arguments', () => {
    const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe(\`Search query. @see entity.ghost\`),
  }),
  blaze: (input) => Result.ok(input),
})`;

    const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('entity.ghost');
  });

  describe('template literals with expressions', () => {
    test('detects @see refs with a leading interpolation', () => {
      const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe(\`search for \${query}. @see entity.ghost\`),
  }),
  blaze: (input) => Result.ok(input),
})`;

      const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('entity.ghost');
    });

    test('detects @see refs across quasis separated by an interpolation', () => {
      const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe(\`\${prefix} @see missing.trail\`),
  }),
  blaze: (input) => Result.ok(input),
})`;

      const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('missing.trail');
    });

    test('still detects @see refs across quasis containing escape sequences', () => {
      const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe(\`path\\\\to\\\\docs. @see missing.trail\`),
  }),
  blaze: (input) => Result.ok(input),
})`;

      const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('missing.trail');
    });

    test('does not emit a phantom @see match when interpolation splits the marker', () => {
      const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe(\`@s\${x}ee missing\`),
  }),
  blaze: (input) => Result.ok(input),
})`;

      const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('does not emit a phantom @see match across multiple interpolations', () => {
      const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe(\`@s\${x}ee \${y} missing\`),
  }),
  blaze: (input) => Result.ok(input),
})`;

      const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('still matches @see when the marker is fully inside a single quasi', () => {
      const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe(\`@see missing.trail \${x}\`),
  }),
  blaze: (input) => Result.ok(input),
})`;

      const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('missing.trail');
    });

    test('does not diagnose when quasis contain no @see token', () => {
      const code = `
trail("entity.show", {
  input: z.object({
    query: z.string().describe(\`\${prefix}\${suffix}\`),
  }),
  blaze: (input) => Result.ok(input),
})`;

      const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

      expect(diagnostics).toHaveLength(0);
    });
  });

  test('ignores describe calls whose argument is not a string literal', () => {
    const code = `
const mapFn = (x) => x;
stream.describe(() => mapFn);

trail("entity.show", {
  input: z.object({ query: z.string() }),
  blaze: (input) => Result.ok(input),
})`;

    const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('does not treat legacy event declarations as valid trail refs', () => {
    const code = `
event("entity.updated", {
  payload: z.object({ id: z.string() }),
})

trail("entity.show", {
  input: z.object({
    query: z.string().describe("Search query. @see entity.updated"),
  }),
  blaze: (input) => Result.ok(input),
})`;

    const diagnostics = validDescribeRefs.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('valid-describe-refs');
    expect(diagnostics[0]?.message).toContain('entity.updated');
  });
});
