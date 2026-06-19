import { describe, expect, test } from 'bun:test';

import { composesDeclarations } from '../rules/composes-declarations.js';

const TEST_FILE = 'test.ts';

describe('composes-declarations', () => {
  describe('clean cases', () => {
    test('declared and called match exactly', () => {
      const code = `
import { trail, Result } from '@ontrails/core';
const t = trail('onboard', {
  composes: ['entity.add', 'search'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose('entity.add', { name: input.name });
    await ctx.compose('search', { query: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('resolves batch ctx.compose() calls with string literals', () => {
      const code = `
trail('onboard', {
  composes: ['entity.add', 'search'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose([
      ['entity.add', { name: input.name }],
      ['search', { query: input.name }],
    ]);
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('no composes declaration and no ctx.compose() calls', () => {
      const code = `
trail('simple', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    return Result.ok({ greeting: 'hello ' + input.name });
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes module-local helper calls that receive the trail context', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const viewEntity = async (input, ctx) => ctx.compose('entity.add', input);

trail('onboard', {
  composes: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const result = await viewEntity(input, ctx);
    return result.isErr() ? result : Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes destructured compose calls inside module-local helpers', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const viewEntity = async (input, ctx) => {
  const { compose } = ctx;
  return compose('entity.add', input);
};

trail('onboard', {
  composes: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const result = await viewEntity(input, ctx);
    return result.isErr() ? result : Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes recursive module-local helper calls that pass context through', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

function composeSearch(input, ctx) {
  return ctx.compose('search', input);
}

const composeAll = async (input, ctx) => {
  await ctx.compose('entity.add', input);
  return composeSearch(input, ctx);
};

trail('onboard', {
  composes: ['entity.add', 'search'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const result = await composeAll(input, ctx);
    return result.isErr() ? result : Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('error cases', () => {
    test('called but not declared produces error', () => {
      const code = `
trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.rule).toBe('composes-declarations');
      expect(diagnostics[0]?.message).toContain("ctx.compose('entity.add')");
      expect(diagnostics[0]?.message).toContain('not declared in composes');
      expect(diagnostics[0]?.message).toContain(
        "composes: ['entity.add', ...]"
      );
    });

    test('undeclared batch compositions still report an error', () => {
      const code = `
trail('onboard', {
  composes: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose([
      ['entity.add', { name: input.name }],
      ['search', { query: input.name }],
    ]);
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.compose('search')");
    });

    test('reports undeclared destructured compose calls inside module-local helpers', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const viewEntity = async (input, ctx) => {
  const { compose } = ctx;
  return compose('entity.add', input);
};

trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const result = await viewEntity(input, ctx);
    return result.isErr() ? result : Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.compose('entity.add')");
    });

    test('does not follow a shadowed helper name inside the blaze body', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const viewEntity = async (input, ctx) => ctx.compose('entity.add', input);

trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async () => {
    const viewEntity = async () => Result.ok({});
    return viewEntity();
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('does not follow a helper name shadowed inside a nested block', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const viewEntity = async (input, ctx) => ctx.compose('entity.add', input);

trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    if (input.name) {
      const viewEntity = async () => Result.ok({});
      return viewEntity(input, ctx);
    }
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('warn cases', () => {
    test('declared but not called produces warning', () => {
      const code = `
trail('onboard', {
  composes: ['entity.add', 'search'],
  blaze: async (input, ctx) => {
    await ctx.compose('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.rule).toBe('composes-declarations');
      expect(diagnostics[0]?.message).toContain(
        "'search' declared in composes"
      );
      expect(diagnostics[0]?.message).toContain('never called');
    });
  });

  describe('single-object overload', () => {
    test('recognizes trail({ id, composes, blaze }) form', () => {
      const code = `
trail({
  id: 'onboard',
  composes: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('detects undeclared compositions in single-object form', () => {
      const code = `
trail({
  id: 'onboard',
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("'entity.add'");
    });
  });

  describe('context parameter naming', () => {
    test('recognizes context.compose() when second param is named context', () => {
      const code = `
trail('onboard', {
  composes: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, context) => {
    await context.compose('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('detects undeclared context.compose() calls', () => {
      const code = `
trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async (input, context) => {
    await context.compose('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
    });

    test('recognizes destructured compose() calls', () => {
      const code = `
trail('onboard', {
  composes: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const { compose } = ctx;
    await compose('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('ignores unrelated local compose() helpers', () => {
      const code = `
trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const compose = (id) => ({ id });
    compose('entity.add');
    await ctx.compose('search', { query: input.name });
    return Result.ok({});
  },
  composes: ['search'],
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes aliased destructured compose() calls', () => {
      const code = `
trail('onboard', {
  composes: ['entity.add'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const { compose: runTrail } = ctx;
    await runTrail('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('blaze with no second parameter: unrelated closure ctx.compose is not tracked', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const ctx = { compose: () => ({}) };

trail('demo', {
  blaze: async () => {
    ctx.compose('entity.add');
    return Result.ok({ ok: true });
  },
  composes: [],
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);
      // The blaze has no context parameter, so `ctx` in the body is an
      // unrelated closure-scoped binding, not the trail context. It must
      // not be tracked — no diagnostics.
      expect(diagnostics.length).toBe(0);
    });

    test('blaze with no second parameter: unrelated closure context.compose is not tracked', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const context = { compose: () => ({}) };

trail('demo', {
  blaze: async () => {
    context.compose('entity.add');
    return Result.ok({ ok: true });
  },
  composes: [],
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });

    test('real blaze ctx.compose to undeclared target is still flagged', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

trail('demo', {
  blaze: async (_, ctx) => {
    await ctx.compose('undeclared');
    return Result.ok({ ok: true });
  },
  composes: [],
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.compose('undeclared')");
    });

    test('defaulted context param is detected (AssignmentPattern)', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const fallbackCtx = { compose: async () => Result.ok({}) };

trail('demo', {
  blaze: async (_input, ctx = fallbackCtx) => {
    await ctx.compose('undeclared');
    return Result.ok({ ok: true });
  },
  composes: [],
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.compose('undeclared')");
    });
  });

  describe('nested run false positives', () => {
    test('meta.run does not trigger false positives', () => {
      const code = `
trail('onboard', {
  composes: ['entity.add'],
  input: z.object({ name: z.string() }),
  meta: { blaze: async () => ctx.compose('phantom') },
  blaze: async (input, ctx) => {
    await ctx.compose('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('identifier resolution in composes arrays', () => {
    test('resolves const identifiers in composes array', () => {
      const code = `
const ENTITY_ADD = 'entity.add';
trail('onboard', {
  composes: [ENTITY_ADD],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose('entity.add', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('reports error when resolved identifier does not match called compose', () => {
      const code = `
const ENTITY_ADD = 'entity.add';
trail('onboard', {
  composes: [ENTITY_ADD],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose('search', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      // 'search' called but not declared, 'entity.add' declared but not called
      expect(diagnostics.length).toBe(2);
    });
  });

  describe('trail object references in composes', () => {
    test('unresolvable identifier in composes softens undeclared to warn', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  composes: [showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose('gist.create', { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      // 'gist.create' called but can't prove showGist doesn't cover it
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain('trail object references');
      expect(diagnostics[0]?.message).toContain('Add the string id');
      expect(diagnostics[0]?.message).toContain(
        'same trail object form in both composes and ctx.compose'
      );
    });

    test('mixed string and trail object references: resolved string still validated', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  composes: ['gist.create', showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose('gist.create', { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      // gist.create declared and called — clean. showGist unresolved but declared, not called by string — no unused warning for unresolved entries.
      expect(diagnostics.length).toBe(0);
    });

    test('trail object only in composes with no string compose calls is clean', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  composes: [showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      // No string-resolved IDs and no string compose calls — clean
      expect(diagnostics.length).toBe(0);
    });
  });

  describe('typed ctx.compose(trailObj) calls', () => {
    test('typed compose call with trail object does not produce undeclared error', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  composes: [showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose(showGist, { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('typed compose call suppresses unused-declaration warning for matching entry', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  composes: ['gist.create', showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose('gist.create', { id: input.id });
    await ctx.compose(showGist, { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      // showGist is unresolvable in composes but the typed compose call covers it
      expect(diagnostics.length).toBe(0);
    });

    test('undeclared string compose alongside typed compose still reports error (softened)', () => {
      const code = `
import { showGist } from '../gist/show';
trail('gist.fork', {
  composes: [showGist],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.compose(showGist, { id: input.id });
    await ctx.compose('undeclared.trail', { id: input.id });
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      // 'undeclared.trail' not declared — softened because showGist is unresolvable
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain('undeclared.trail');
    });
  });

  describe('edge cases', () => {
    test('dynamic compose IDs are skipped', () => {
      const code = `
trail('dispatch', {
  composes: ['entity.add'],
  blaze: async (input, ctx) => {
    const trailId = input.target;
    await ctx.compose(trailId, input);
    await ctx.compose('entity.add', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('multiple trails in one file are validated independently', () => {
      const code = `
trail('alpha', {
  composes: ['shared'],
  blaze: async (input, ctx) => {
    await ctx.compose('shared', input);
    return Result.ok({});
  },
});

trail('beta', {
  blaze: async (input, ctx) => {
    await ctx.compose('undeclared', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('Trail "beta"');
      expect(diagnostics[0]?.message).toContain("'undeclared'");
      expect(diagnostics[0]?.severity).toBe('error');
    });

    test('skips test files', () => {
      const code = `
trail('onboard', {
  blaze: async (input, ctx) => {
    await ctx.compose('entity.add', input);
    return Result.ok({});
  },
});
`;

      const diagnostics = composesDeclarations.check(
        code,
        'src/__tests__/trails.test.ts'
      );

      expect(diagnostics.length).toBe(0);
    });
  });
});
