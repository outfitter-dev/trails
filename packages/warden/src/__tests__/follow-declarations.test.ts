import { describe, expect, test } from 'bun:test';

import { followDeclarations } from '../rules/follow-declarations.js';

const TEST_FILE = 'test.ts';

describe('follow-declarations', () => {
  describe('clean cases', () => {
    test('declared and called match exactly', () => {
      const code = `
import { trail, Result } from '@ontrails/core';
const t = trail('onboard', {
  follow: ['entity.add', 'search'],
  input: z.object({ name: z.string() }),
  run: async (input, ctx) => {
    await ctx.follow('entity.add', { name: input.name });
    await ctx.follow('search', { query: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('no follow declaration and no ctx.follow() calls', () => {
      const code = `
trail('simple', {
  input: z.object({ name: z.string() }),
  run: async (input, ctx) => {
    return Result.ok({ greeting: 'hello ' + input.name });
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('error cases', () => {
    test('called but not declared produces error', () => {
      const code = `
trail('onboard', {
  input: z.object({ name: z.string() }),
  run: async (input, ctx) => {
    await ctx.follow('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.rule).toBe('follow-declarations');
      expect(diagnostics[0]?.message).toContain("ctx.follow('entity.add')");
      expect(diagnostics[0]?.message).toContain('not declared in follow');
    });
  });

  describe('warn cases', () => {
    test('declared but not called produces warning', () => {
      const code = `
trail('onboard', {
  follow: ['entity.add', 'search'],
  run: async (input, ctx) => {
    await ctx.follow('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.rule).toBe('follow-declarations');
      expect(diagnostics[0]?.message).toContain("'search' declared in follow");
      expect(diagnostics[0]?.message).toContain('never called');
    });
  });

  describe('single-object overload', () => {
    test('recognizes trail({ id, follow, run }) form', () => {
      const code = `
trail({
  id: 'onboard',
  follow: ['entity.add'],
  input: z.object({ name: z.string() }),
  run: async (input, ctx) => {
    await ctx.follow('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('detects undeclared follows in single-object form', () => {
      const code = `
trail({
  id: 'onboard',
  input: z.object({ name: z.string() }),
  run: async (input, ctx) => {
    await ctx.follow('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("'entity.add'");
    });
  });

  describe('context parameter naming', () => {
    test('recognizes context.follow() when second param is named context', () => {
      const code = `
trail('onboard', {
  follow: ['entity.add'],
  input: z.object({ name: z.string() }),
  run: async (input, context) => {
    await context.follow('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('detects undeclared context.follow() calls', () => {
      const code = `
trail('onboard', {
  input: z.object({ name: z.string() }),
  run: async (input, context) => {
    await context.follow('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
    });

    test('recognizes destructured follow() calls', () => {
      const code = `
trail('onboard', {
  follow: ['entity.add'],
  input: z.object({ name: z.string() }),
  run: async (input, ctx) => {
    const { follow } = ctx;
    await follow('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('nested run false positives', () => {
    test('metadata.run does not trigger false positives', () => {
      const code = `
trail('onboard', {
  follow: ['entity.add'],
  input: z.object({ name: z.string() }),
  metadata: { run: async () => ctx.follow('phantom') },
  run: async (input, ctx) => {
    await ctx.follow('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('identifier resolution in follow arrays', () => {
    test('resolves const identifiers in follow array', () => {
      const code = `
const ENTITY_ADD = 'entity.add';
trail('onboard', {
  follow: [ENTITY_ADD],
  input: z.object({ name: z.string() }),
  run: async (input, ctx) => {
    await ctx.follow('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('reports error when resolved identifier does not match called follow', () => {
      const code = `
const ENTITY_ADD = 'entity.add';
trail('onboard', {
  follow: [ENTITY_ADD],
  input: z.object({ name: z.string() }),
  run: async (input, ctx) => {
    await ctx.follow('search', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      // 'search' called but not declared, 'entity.add' declared but not called
      expect(diagnostics.length).toBe(2);
    });
  });

  describe('edge cases', () => {
    test('dynamic follow IDs are skipped', () => {
      const code = `
trail('dispatch', {
  follow: ['entity.add'],
  run: async (input, ctx) => {
    const trailId = input.target;
    await ctx.follow(trailId, input);
    await ctx.follow('entity.add', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('multiple trails in one file are validated independently', () => {
      const code = `
trail('alpha', {
  follow: ['shared'],
  run: async (input, ctx) => {
    await ctx.follow('shared', input);
    return Result.ok({});
  },
});

trail('beta', {
  run: async (input, ctx) => {
    await ctx.follow('undeclared', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('Trail "beta"');
      expect(diagnostics[0]?.message).toContain("'undeclared'");
      expect(diagnostics[0]?.severity).toBe('error');
    });

    test('skips test files', () => {
      const code = `
trail('onboard', {
  run: async (input, ctx) => {
    await ctx.follow('entity.add', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = followDeclarations.check(
        code,
        'src/__tests__/trails.test.ts'
      );

      expect(diagnostics.length).toBe(0);
    });
  });
});
