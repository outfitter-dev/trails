import { describe, expect, test } from 'bun:test';

import { crossDeclarations } from '../rules/cross-declarations.js';

const TEST_FILE = 'test.ts';

describe('cross-declarations', () => {
  describe('clean cases', () => {
    test('declared and called match exactly', () => {
      const code = `
import { trail, Result } from '@ontrails/core';
const t = trail('onboard', {
  crosses: ['entity.add', 'search'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross('entity.add', { name: input.name });
    await ctx.cross('search', { query: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('resolves batch ctx.cross() calls with string literals', () => {
      const code = `
trail('onboard', {
  crosses: ['entity.add', 'search'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross([
      ['entity.add', { name: input.name }],
      ['search', { query: input.name }],
    ]);
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('no crosses declaration and no ctx.cross() calls', () => {
      const code = `
trail('simple', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    return Result.ok({ greeting: 'hello ' + input.name });
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('error cases', () => {
    test('called but not declared produces error', () => {
      const code = `
trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.rule).toBe('cross-declarations');
      expect(diagnostics[0]?.message).toContain("ctx.cross('entity.add')");
      expect(diagnostics[0]?.message).toContain('not declared in crosses');
    });

    test('undeclared batch crossings still report an error', () => {
      const code = `
trail('onboard', {
  crosses: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross([
      ['entity.add', { name: input.name }],
      ['search', { query: input.name }],
    ]);
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.cross('search')");
    });
  });

  describe('warn cases', () => {
    test('declared but not called produces warning', () => {
      const code = `
trail('onboard', {
  crosses: ['entity.add', 'search'],
  blaze: async (input, ctx) => {
    await ctx.cross('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.rule).toBe('cross-declarations');
      expect(diagnostics[0]?.message).toContain("'search' declared in crosses");
      expect(diagnostics[0]?.message).toContain('never called');
    });
  });

  describe('single-object overload', () => {
    test('recognizes trail({ id, crosses, blaze }) form', () => {
      const code = `
trail({
  id: 'onboard',
  crosses: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('detects undeclared crossings in single-object form', () => {
      const code = `
trail({
  id: 'onboard',
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("'entity.add'");
    });
  });

  describe('context parameter naming', () => {
    test('recognizes context.cross() when second param is named context', () => {
      const code = `
trail('onboard', {
  crosses: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, context) => {
    await context.cross('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('detects undeclared context.cross() calls', () => {
      const code = `
trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async (input, context) => {
    await context.cross('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
    });

    test('recognizes destructured cross() calls', () => {
      const code = `
trail('onboard', {
  crosses: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const { cross } = ctx;
    await cross('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('blaze with no second parameter: unrelated closure ctx.cross is not tracked', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const ctx = { cross: () => ({}) };

trail('demo', {
  blaze: async () => {
    ctx.cross('entity.add');
    return Result.ok({ ok: true });
  },
  crosses: [],
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);
      // The blaze has no context parameter, so `ctx` in the body is an
      // unrelated closure-scoped binding, not the trail context. It must
      // not be tracked — no diagnostics.
      expect(diagnostics.length).toBe(0);
    });

    test('blaze with no second parameter: unrelated closure context.cross is not tracked', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const context = { cross: () => ({}) };

trail('demo', {
  blaze: async () => {
    context.cross('entity.add');
    return Result.ok({ ok: true });
  },
  crosses: [],
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });

    test('real blaze ctx.cross to undeclared target is still flagged', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

trail('demo', {
  blaze: async (_, ctx) => {
    await ctx.cross('undeclared');
    return Result.ok({ ok: true });
  },
  crosses: [],
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.cross('undeclared')");
    });

    test('defaulted context param is detected (AssignmentPattern)', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const fallbackCtx = { cross: async () => Result.ok({}) };

trail('demo', {
  blaze: async (_input, ctx = fallbackCtx) => {
    await ctx.cross('undeclared');
    return Result.ok({ ok: true });
  },
  crosses: [],
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.cross('undeclared')");
    });
  });

  describe('nested run false positives', () => {
    test('meta.run does not trigger false positives', () => {
      const code = `
trail('onboard', {
  crosses: ['entity.add'],
  input: z.object({ name: z.string() }),
  meta: { blaze: async () => ctx.cross('phantom') },
  blaze: async (input, ctx) => {
    await ctx.cross('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('identifier resolution in crosses arrays', () => {
    test('resolves const identifiers in crosses array', () => {
      const code = `
const ENTITY_ADD = 'entity.add';
trail('onboard', {
  crosses: [ENTITY_ADD],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('reports error when resolved identifier does not match called cross', () => {
      const code = `
const ENTITY_ADD = 'entity.add';
trail('onboard', {
  crosses: [ENTITY_ADD],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross('search', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      // 'search' called but not declared, 'entity.add' declared but not called
      expect(diagnostics.length).toBe(2);
    });
  });

  describe('trail object references in crosses', () => {
    test('unresolvable identifier in crosses softens undeclared to warn', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  crosses: [showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross('gist.create', { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      // 'gist.create' called but can't prove showGist doesn't cover it
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain('trail object references');
    });

    test('mixed string and trail object references: resolved string still validated', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  crosses: ['gist.create', showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross('gist.create', { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      // gist.create declared and called — clean. showGist unresolved but declared, not called by string — no unused warning for unresolved entries.
      expect(diagnostics.length).toBe(0);
    });

    test('trail object only in crosses with no string cross calls is clean', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  crosses: [showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      // No string-resolved IDs and no string cross calls — clean
      expect(diagnostics.length).toBe(0);
    });
  });

  describe('typed ctx.cross(trailObj) calls', () => {
    test('typed cross call with trail object does not produce undeclared error', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  crosses: [showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross(showGist, { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('typed cross call suppresses unused-declaration warning for matching entry', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  crosses: ['gist.create', showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross('gist.create', { id: input.id });
    await ctx.cross(showGist, { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      // showGist is unresolvable in crosses but the typed cross call covers it
      expect(diagnostics.length).toBe(0);
    });

    test('undeclared string cross alongside typed cross still reports error (softened)', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  crosses: [showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.cross(showGist, { id: input.id });
    await ctx.cross('undeclared.trail', { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      // 'undeclared.trail' not declared — softened because showGist is unresolvable
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain('undeclared.trail');
    });
  });

  describe('edge cases', () => {
    test('dynamic cross IDs are skipped', () => {
      const code = `
trail('dispatch', {
  crosses: ['entity.add'],
  blaze: async (input, ctx) => {
    const trailId = input.target;
    await ctx.cross(trailId, input);
    await ctx.cross('entity.add', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('multiple trails in one file are validated independently', () => {
      const code = `
trail('alpha', {
  crosses: ['shared'],
  blaze: async (input, ctx) => {
    await ctx.cross('shared', input);
    return Result.ok({});
  },
});

trail('beta', {
  blaze: async (input, ctx) => {
    await ctx.cross('undeclared', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('Trail "beta"');
      expect(diagnostics[0]?.message).toContain("'undeclared'");
      expect(diagnostics[0]?.severity).toBe('error');
    });

    test('skips test files', () => {
      const code = `
trail('onboard', {
  blaze: async (input, ctx) => {
    await ctx.cross('entity.add', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = crossDeclarations.check(
        code,
        'src/__tests__/trails.test.ts'
      );

      expect(diagnostics.length).toBe(0);
    });
  });
});
