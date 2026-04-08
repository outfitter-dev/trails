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

    test('optional-chained ctx.fire?.() call matching declaration is clean', () => {
      const code = `
trail('optionalChain', {
  fires: ['declared.signal'],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire?.('declared.signal', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // Optional-chain invocation of ctx.fire must not produce false positives.
      // Locks in current behavior so the dogfood demo's `ctx.fire?.(...)` stays
      // clean regardless of future AST walker changes.
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

    test('blaze with no second parameter: unrelated closure ctx.fire is not tracked', () => {
      const code = `
const ctx = { fire: (_: string) => {} };
trail('noCtxParam', {
  blaze: async (input) => {
    ctx.fire('closure.signal');
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // The blaze has no context parameter, so `ctx` in the body refers to
      // some unrelated closure identifier, not a trail context. It must not
      // be tracked — no diagnostics.
      expect(diagnostics.length).toBe(0);
    });

    test('custom-named context param: only that name is tracked', () => {
      const code = `
const ctx = { fire: (_: string) => {} };
trail('customCtx', {
  fires: ['declared.id'],
  blaze: async (input, c) => {
    await c.fire('declared.id', {});
    ctx.fire('whatever');
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // `c.fire('declared.id')` matches the declaration. The unrelated
      // closure `ctx.fire('whatever')` must not be flagged because `ctx` is
      // not the trail context — only `c` is.
      expect(diagnostics.length).toBe(0);
    });

    test('custom-named context param: undeclared call via that name is flagged', () => {
      const code = `
trail('customCtxUndeclared', {
  fires: ['declared.id'],
  blaze: async (input, c) => {
    await c.fire('undeclared.id', {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      const undeclared = diagnostics.filter((d) =>
        d.message.includes("'undeclared.id'")
      );
      expect(undeclared.length).toBe(1);
      expect(undeclared[0]?.severity).toBe('error');
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

  describe('bare fire() helpers', () => {
    test('unrelated local fire() helper is not flagged', () => {
      const code = `
import { trail, Result } from '@ontrails/core';
const fire = (x: number) => x * 2;
const t = trail('calc', {
  input: z.object({ n: z.number() }),
  blaze: async (input, ctx) => {
    const doubled = fire(input.n);
    return Result.ok({ doubled });
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      // Neither declared nor "called" from the trail's perspective.
      expect(diagnostics.length).toBe(0);
    });

    test('destructured { fire } from ctx is tracked', () => {
      const code = `
trail('onboard', {
  fires: ['entity.created'],
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
    test('nested-scope destructure does not leak to outer blaze scope', () => {
      const code = `
trail('outer', {
  blaze: async (input, ctx) => {
    function nested() {
      const { fire } = ctx;
      return fire;
    }
    fire('outer.signal');
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // Top-level fire('outer.signal') should NOT be treated as a ctx call —
      // the nested destructure must not leak out.
      expect(diagnostics.length).toBe(0);
    });

    test('top-level destructure is still tracked (regression check)', () => {
      const code = `
trail('tracked', {
  blaze: async (input, ctx) => {
    const { fire } = ctx;
    await fire('undeclared.signal', {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("'undeclared.signal'");
    });

    test('nested function parameter shadowing fire is not flagged', () => {
      const code = `
trail('shadowFire', {
  blaze: async (_, ctx) => {
    const { fire } = ctx;
    function nested(fire) {
      fire('shadow.only');
    }
    nested(() => {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // The nested parameter shadows the outer destructured `fire`, so the
      // call inside `nested` must not be treated as a trail fire.
      expect(diagnostics.length).toBe(0);
    });

    test('nested function parameter shadowing ctx is not flagged', () => {
      const code = `
trail('shadowCtx', {
  blaze: async (_, ctx) => {
    function nested(ctx) {
      ctx.fire('shadow.ctx');
    }
    nested({});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });

    test('nested arrow with legitimate ctx.fire is not flagged as undeclared', () => {
      const code = `
trail('nestedLegit', {
  fires: ['legitimate.signal'],
  blaze: async (input, ctx) => {
    const runLater = () => ctx.fire('legitimate.signal', {});
    runLater();
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // Precision tradeoff: the nested arrow isn't walked, so the warden sees
      // the declared 'legitimate.signal' as "unused". What matters for the
      // P1 bug is that it is NOT reported as undeclared (no false error).
      const undeclared = diagnostics.filter((d) =>
        d.message.includes('not declared in fires')
      );
      expect(undeclared.length).toBe(0);
    });

    test('top-level ctx.fire with matching declaration still clean (regression)', () => {
      const code = `
trail('regression', {
  fires: ['declared.signal'],
  blaze: async (input, ctx) => {
    await ctx.fire('declared.signal', {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });

    test('let { fire: emit } = ctx is not tracked (precision tradeoff)', () => {
      const code = `
trail('letDestructure', {
  blaze: async (input, ctx) => {
    let { fire: emit } = ctx;
    emit('some.id');
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // Only `const` destructures are tracked. `let` / `var` allow
      // reassignment which this flow-insensitive walker cannot follow, so
      // `emit` is treated as unrelated and no diagnostic is produced.
      expect(diagnostics.length).toBe(0);
    });

    test('destructured { fire: emit } alias from ctx is tracked', () => {
      const code = `
trail('onboard', {
  fires: ['entity.created'],
  blaze: async (input, ctx) => {
    const { fire: emit } = ctx;
    await emit('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });
  });

  describe('object-form fires declarations', () => {
    test('Signal value reference downgrades undeclared to warn', () => {
      const code = `
import { trail, signal, Result } from '@ontrails/core';
const orderPlaced = signal('order.placed', { payload: z.object({}) });
trail('checkout', {
  fires: [orderPlaced],
  blaze: async (input, ctx) => {
    await ctx.fire('order.placed', {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // Object-form makes the declared set unresolvable — downgrade undeclared
      // to warn rather than silently suppressing; runtime normalization in
      // trail() may cover the call.
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain('object-form fires entries');
    });

    test('genuinely undeclared string call alongside Signal value is downgraded to warn', () => {
      const code = `
import { trail, signal, Result } from '@ontrails/core';
const orderPlaced = signal('order.placed', { payload: z.object({}) });
trail('checkout', {
  fires: [orderPlaced],
  blaze: async (input, ctx) => {
    await ctx.fire('audit.logged', {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // Cannot statically prove 'audit.logged' isn't covered by the object-form
      // entry, but also cannot stay silent — warn with disclaimer.
      const undeclared = diagnostics.filter((d) =>
        d.message.includes("'audit.logged'")
      );
      expect(undeclared.length).toBe(1);
      expect(undeclared[0]?.severity).toBe('warn');
      expect(undeclared[0]?.message).toContain(
        'may be declared via object-form fires entries'
      );
    });

    test('mixed string + Signal value — resolved string still matches, unresolved warns', () => {
      const code = `
import { trail, signal, Result } from '@ontrails/core';
const orderPlaced = signal('order.placed', { payload: z.object({}) });
trail('checkout', {
  fires: ['audit.logged', orderPlaced],
  blaze: async (input, ctx) => {
    await ctx.fire('order.placed', {});
    await ctx.fire('audit.logged', {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // 'audit.logged' resolves from the string literal; 'order.placed' can't
      // be resolved statically so it downgrades to warn.
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain("'order.placed'");
      expect(diagnostics[0]?.message).toContain('object-form fires entries');
    });
  });
});
