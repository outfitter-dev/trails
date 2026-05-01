import { describe, expect, test } from 'bun:test';

import { firesDeclarations } from '../rules/fires-declarations.js';

const TEST_FILE = 'test.ts';

describe('fires-declarations', () => {
  describe('clean cases', () => {
    test('declared and called match exactly', () => {
      const code = `
import { trail, Result } from '@ontrails/core';
const entityCreated = signal('entity.created', { payload: z.object({}) });
const auditLogged = signal('audit.logged', { payload: z.object({}) });
const t = trail('onboard', {
  fires: [entityCreated, auditLogged],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire(entityCreated, { name: input.name });
    await ctx.fire(auditLogged, { actor: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('optional-chained ctx.fire?.() call matching declaration is clean', () => {
      const code = `
const declaredSignal = signal('declared.signal', { payload: z.object({}) });
trail('optionalChain', {
  fires: [declaredSignal],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire?.(declaredSignal, { name: input.name });
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
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail('onboard', {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire(entityCreated, { name: input.name });
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

    test('string ctx.fire call produces an API-shape error', () => {
      const code = `
trail('onboard', {
  fires: ['entity.created'],
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
      expect(diagnostics[0]?.message).toContain(
        "ctx.fire('entity.created') uses a string signal id"
      );
      expect(diagnostics[0]?.message).toContain('Signal value');
    });
  });

  describe('warn cases', () => {
    test('declared but not called produces warning', () => {
      const code = `
const entityCreated = signal('entity.created', { payload: z.object({}) });
const auditLogged = signal('audit.logged', { payload: z.object({}) });
trail('onboard', {
  fires: [entityCreated, auditLogged],
  blaze: async (input, ctx) => {
    await ctx.fire(entityCreated, { name: input.name });
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
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail({
  id: 'onboard',
  fires: [entityCreated],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire(entityCreated, { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('detects undeclared fires in single-object form', () => {
      const code = `
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail({
  id: 'onboard',
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire(entityCreated, { name: input.name });
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
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail('onboard', {
  fires: [entityCreated],
  input: z.object({ name: z.string() }),
  blaze: async (input, context) => {
    await context.fire(entityCreated, { name: input.name });
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
const declared = signal('declared.id', { payload: z.object({}) });
const ctx = { fire: (_: string) => {} };
trail('customCtx', {
  fires: [declared],
  blaze: async (input, c) => {
    await c.fire(declared, {});
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
const declared = signal('declared.id', { payload: z.object({}) });
const undeclared = signal('undeclared.id', { payload: z.object({}) });
trail('customCtxUndeclared', {
  fires: [declared],
  blaze: async (input, c) => {
    await c.fire(undeclared, {});
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
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail('onboard', {
  fires: [entityCreated],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    const { fire } = ctx;
    await fire(entityCreated, { name: input.name });
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
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail('onboard', {
  fires: [entityCreated],
  input: z.object({ name: z.string() }),
  meta: { blaze: async () => ctx.fire('phantom') },
  blaze: async (input, ctx) => {
    await ctx.fire(entityCreated, { name: input.name });
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
const entityCreated = signal('entity.created', { payload: z.object({}) });
const ENTITY_CREATED = 'entity.created';
trail('onboard', {
  fires: [ENTITY_CREATED],
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    await ctx.fire(entityCreated, { name: input.name });
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
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail('dispatch', {
  fires: ['entity.created'],
  blaze: async (input, ctx) => {
    const signalId = input.target;
    await ctx.fire(signalId, input);
    await ctx.fire(entityCreated, input);
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('multiple trails in one file are validated independently', () => {
      const code = `
const sharedSignal = signal('shared.signal', { payload: z.object({}) });
const undeclaredSignal = signal('undeclared.signal', { payload: z.object({}) });
trail('alpha', {
  fires: [sharedSignal],
  blaze: async (input, ctx) => {
    await ctx.fire(sharedSignal, input);
    return Result.ok({});
  },
});

trail('beta', {
  blaze: async (input, ctx) => {
    await ctx.fire(undeclaredSignal, input);
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
const declaredOnly = signal('declared.only', { payload: z.object({}) });
const calledOnly = signal('called.only', { payload: z.object({}) });
trail('mixed', {
  fires: [declaredOnly],
  blaze: async (input, ctx) => {
    await ctx.fire(calledOnly, input);
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
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail('onboard', {
  fires: [entityCreated],
  blaze: async (input, ctx) => {
    const { fire } = ctx;
    await fire(entityCreated, { name: input.name });
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
const undeclared = signal('undeclared.signal', { payload: z.object({}) });
trail('tracked', {
  blaze: async (input, ctx) => {
    const { fire } = ctx;
    await fire(undeclared, {});
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

    test('top-level ctx.fire with matching declaration still clean (regression)', () => {
      const code = `
const declaredSignal = signal('declared.signal', { payload: z.object({}) });
trail('regression', {
  fires: [declaredSignal],
  blaze: async (input, ctx) => {
    await ctx.fire(declaredSignal, {});
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
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail('onboard', {
  fires: [entityCreated],
  blaze: async (input, ctx) => {
    const { fire: emit } = ctx;
    await emit(entityCreated, { name: input.name });
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });
  });

  describe('object-form fires declarations', () => {
    test('local Signal value reference resolves cleanly', () => {
      const code = `
import { trail, signal, Result } from '@ontrails/core';
const orderPlaced = signal('order.placed', { payload: z.object({}) });
trail('checkout', {
  fires: [orderPlaced],
  blaze: async (input, ctx) => {
    await ctx.fire(orderPlaced, {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });

    test('known Signal call alongside unresolved imported declaration is downgraded to warn', () => {
      const code = `
import { trail, signal, Result } from '@ontrails/core';
import { orderPlaced } from './signals';
const auditLogged = signal('audit.logged', { payload: z.object({}) });
trail('checkout', {
  fires: [orderPlaced],
  blaze: async (input, ctx) => {
    await ctx.fire(auditLogged, {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      // Cannot statically prove the imported Signal declaration does not cover
      // this known local Signal call, but also cannot stay silent.
      const undeclared = diagnostics.filter((d) =>
        d.message.includes("'audit.logged'")
      );
      expect(undeclared.length).toBe(1);
      expect(undeclared[0]?.severity).toBe('warn');
      expect(undeclared[0]?.message).toContain(
        'may be declared via object-form fires entries'
      );
    });

    test('mixed string + local Signal value resolves cleanly', () => {
      const code = `
import { trail, signal, Result } from '@ontrails/core';
const orderPlaced = signal('order.placed', { payload: z.object({}) });
const auditLogged = signal('audit.logged', { payload: z.object({}) });
trail('checkout', {
  fires: ['audit.logged', orderPlaced],
  blaze: async (input, ctx) => {
    await ctx.fire(orderPlaced, {});
    await ctx.fire(auditLogged, {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });

    test('fires array resolves module-scope signal when blaze shadows the name', () => {
      const code = `
import { trail, signal, Result } from '@ontrails/core';
const orderPlaced = signal('order.placed', { payload: z.object({}) });
trail('checkout', {
  fires: [orderPlaced],
  blaze: async (input, ctx) => {
    const orderPlaced = signal('audit.logged', { payload: z.object({}) });
    await ctx.fire(orderPlaced, {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(
        diagnostics.some((d) => d.message.includes("ctx.fire('audit.logged')"))
      ).toBe(true);
      expect(
        diagnostics.some((d) =>
          d.message.includes("'order.placed' declared in fires")
        )
      ).toBe(true);
    });

    test('imported fires entry with local shadowed signal call is not clean', () => {
      const code = `
import { trail, signal, Result } from '@ontrails/core';
import { orderPlaced } from './signals';
trail('checkout', {
  fires: [orderPlaced],
  blaze: async (input, ctx) => {
    const orderPlaced = signal('audit.logged', { payload: z.object({}) });
    await ctx.fire(orderPlaced, {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain(
        "ctx.fire('audit.logged') called"
      );
      expect(diagnostics[0]?.message).toContain(
        'may be declared via object-form fires entries'
      );
    });

    test('non-signal inner shadow blocks outer signal resolution', () => {
      const code = `
import { trail, signal, Result } from '@ontrails/core';
const orderPlaced = signal('order.placed', { payload: z.object({}) });
trail('checkout', {
  fires: [orderPlaced],
  blaze: async (input, ctx) => {
    const orderPlaced = input.target;
    await ctx.fire(orderPlaced, {});
    return Result.ok({});
  },
});
`;

      const diagnostics = firesDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain(
        "'order.placed' declared in fires"
      );
    });
  });
});

describe('fires-declarations helper-scoped blind spots', () => {
  test('helper-scoped ctx.fire stays a documented unused-only blind spot', () => {
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
    // Precision tradeoff: helper-scoped ctx.fire isn't walked yet, so the
    // rule sees the declared signal as "unused" today. What matters is that
    // it is NOT reported as undeclared, and that the limitation stays
    // stable until helper-aware analysis lands.
    const undeclared = diagnostics.filter((d) =>
      d.message.includes('not declared in fires')
    );
    const unused = diagnostics.filter((d) =>
      d.message.includes("'legitimate.signal' declared in fires")
    );
    expect(undeclared.length).toBe(0);
    expect(unused.length).toBe(1);
  });

  test('helper-local destructured fire stays a documented unused-only blind spot', () => {
    const code = `
trail('nestedDestructure', {
  fires: ['helper.signal'],
  blaze: async (input, ctx) => {
    const runLater = () => {
      const { fire } = ctx;
      return fire('helper.signal', {});
    };
    runLater();
    return Result.ok({});
  },
});
`;

    const diagnostics = firesDeclarations.check(code, TEST_FILE);
    const undeclared = diagnostics.filter((d) =>
      d.message.includes('not declared in fires')
    );
    const unused = diagnostics.filter((d) =>
      d.message.includes("'helper.signal' declared in fires")
    );
    expect(undeclared.length).toBe(0);
    expect(unused.length).toBe(1);
  });
});
