import { describe, expect, test } from 'bun:test';

import { noThrowInDetourTarget } from '../rules/no-throw-in-detour-target.js';

const TEST_FILE = 'test.ts';

describe('no-throw-in-detour-target', () => {
  test('flags throw inside a detour target implementation', () => {
    const code = `
trail("entity.show", {
  detours: { NotFoundError: ["entity.fallback"] },
  blaze: async (input, ctx) => Result.ok({ id: "123" })
})

trail("entity.fallback", {
  blaze: async (input, ctx) => {
    throw new Error("boom");
  }
})`;

    const diagnostics = noThrowInDetourTarget.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.rule).toBe('no-throw-in-detour-target');
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('allows throw in implementations that are not detour targets', () => {
    const code = `
trail("entity.show", {
  blaze: async (input, ctx) => {
    throw new Error("boom");
  }
})`;

    const diagnostics = noThrowInDetourTarget.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(0);
  });

  test('flags concise detour target implementations that throw inline', () => {
    const code = `
trail("entity.show", {
  detours: { NotFoundError: ["entity.fallback"] },
  blaze: async (input, ctx) => Result.ok({ id: "123" })
})

trail("entity.fallback", {
  blaze: async (input, ctx) => { throw new Error("boom"); }
})`;

    const diagnostics = noThrowInDetourTarget.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.fallback');
  });

  test('uses project context when the detour target is defined in another file', () => {
    const code = `
trail("entity.fallback", {
  blaze: async (input, ctx) => {
    throw new Error("boom");
  }
})`;

    const diagnostics = noThrowInDetourTarget.checkWithContext(
      code,
      TEST_FILE,
      {
        detourTargetTrailIds: new Set(['entity.fallback']),
        knownTrailIds: new Set(['entity.show', 'entity.fallback']),
      }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-throw-in-detour-target');
  });

  test('does not flag throw inside a nested .map() callback of a detour target', () => {
    const code = `
trail("entity.show", {
  detours: { NotFoundError: ["entity.fallback"] },
  blaze: async (input, ctx) => Result.ok({ id: "123" })
})

trail("entity.fallback", {
  blaze: async (input, ctx) => {
    [1].map(() => {
      throw new Error("boom");
    });
    return Result.ok({ ok: true });
  }
})`;

    const diagnostics = noThrowInDetourTarget.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(0);
  });

  test('does not flag throw inside a nested function declaration of a detour target', () => {
    const code = `
trail("entity.show", {
  detours: { NotFoundError: ["entity.fallback"] },
  blaze: async (input, ctx) => Result.ok({ id: "123" })
})

trail("entity.fallback", {
  blaze: async (input, ctx) => {
    function helper() {
      throw new Error("boom");
    }
    return Result.ok({ ok: true });
  }
})`;

    const diagnostics = noThrowInDetourTarget.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(0);
  });

  test('still flags direct throw in a detour target alongside a safe nested callback', () => {
    const code = `
trail("entity.show", {
  detours: { NotFoundError: ["entity.fallback"] },
  blaze: async (input, ctx) => Result.ok({ id: "123" })
})

trail("entity.fallback", {
  blaze: async (input, ctx) => {
    [1].map(() => {
      throw new Error("inner — allowed");
    });
    throw new Error("outer — flagged");
  }
})`;

    const diagnostics = noThrowInDetourTarget.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-throw-in-detour-target');
  });
});
