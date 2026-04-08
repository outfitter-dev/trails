import { describe, expect, test } from 'bun:test';

import { firesDeclarations } from '../rules/fires-declarations.js';

const TEST_FILE = 'test.ts';

describe('fires-declarations', () => {
  describe('clean cases', () => {
    test('declared and called match exactly', () => {
      const code = `
import { trail, Result } from '@ontrails/core';
const t = trail('onboard', {
  fires: ['entity.created', 'audit.logged'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire('entity.created', { name: input.name });
    await ctx.fire('audit.logged', { actor: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('no fires declaration and no ctx.fire() calls', () => {
      const code = `
trail('simple', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    return Result.ok({ greeting: 'hello ' + input.name });
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('error cases', () => {
    test('called but not declared produces error', () => {
      const code = `
trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.rule).toBe('fires-declarations');
      expect(diagnostics[0]?.message).toContain("ctx.fire('entity.created')");
      expect(diagnostics[0]?.message).toContain('not declared in fires');
    });
  });

  describe('warn cases', () => {
    test('declared but not called produces warning', () => {
      const code = `
trail('onboard', {
  fires: ['entity.created', 'audit.logged'],
  blaze: async (input, ctx) => {
    await ctx.fire('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.rule).toBe('fires-declarations');
      expect(diagnostics[0]?.message).toContain(
        "'audit.logged' declared in fires"
      );
      expect(diagnostics[0]?.message).toContain('never called');
    });
  });

  describe('single-object overload', () => {
    test('recognizes trail({ id, fires, blaze }) form', () => {
      const code = `
trail({
  id: 'onboard',
  fires: ['entity.created'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('detects undeclared fires in single-object form', () => {
      const code = `
trail({
  id: 'onboard',
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("'entity.created'");
    });
  });

  describe('context parameter naming', () => {
    test('recognizes context.fire() when second param is named context', () => {
      const code = `
trail('onboard', {
  fires: ['entity.created'],
  input: z.object({ name: z.string() }),
  blaze: async (input, context) => {
    await context.fire('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes destructured fire() calls', () => {
      const code = `
trail('onboard', {
  fires: ['entity.created'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const { fire } = ctx;
    await fire('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('nested run false positives', () => {
    test('meta.blaze with phantom fire does not trigger false positives', () => {
      const code = `
trail('onboard', {
  fires: ['entity.created'],
  input: z.object({ name: z.string() }),
  meta: { blaze: async () => ctx.fire('phantom') },
  blaze: async (input, ctx) => {
    await ctx.fire('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('identifier resolution in fires arrays', () => {
    test('resolves const identifiers in fires array', () => {
      const code = `
const ENTITY_CREATED = 'entity.created';
trail('onboard', {
  fires: [ENTITY_CREATED],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('dynamic fire IDs are skipped', () => {
      const code = `
trail('dispatch', {
  fires: ['entity.created'],
  blaze: async (input, ctx) => {
    const signalId = input.target;
    await ctx.fire(signalId, input);
    await ctx.fire('entity.created', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('multiple trails in one file are validated independently', () => {
      const code = `
trail('alpha', {
  fires: ['shared.signal'],
  blaze: async (input, ctx) => {
    await ctx.fire('shared.signal', input);
    return Result.ok({});
  },
});

trail('beta', {
  blaze: async (input, ctx) => {
    await ctx.fire('undeclared.signal', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('Trail "beta"');
      expect(diagnostics[0]?.message).toContain("'undeclared.signal'");
      expect(diagnostics[0]?.severity).toBe('error');
    });

    test('skips test files', () => {
      const code = `
trail('onboard', {
  blaze: async (input, ctx) => {
    await ctx.fire('entity.created', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(
        code,
        'src/__tests__/trails.test.ts'
      );

      expect(diagnostics.length).toBe(0);
    });

    test('both wrong: called and undeclared, declared and unused', () => {
      const code = `
trail('mixed', {
  fires: ['declared.only'],
  blaze: async (input, ctx) => {
    await ctx.fire('called.only', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(2);
      const errors = diagnostics.filter((d) => d.severity === 'error');
      const warns = diagnostics.filter((d) => d.severity === 'warn');
      expect(errors.length).toBe(1);
      expect(warns.length).toBe(1);
    });
  });
});
