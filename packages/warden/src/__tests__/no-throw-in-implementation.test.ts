import { describe, expect, test } from 'bun:test';

import { noThrowInImplementation } from '../rules/no-throw-in-implementation.js';

const TEST_FILE = 'test.ts';

describe('no-throw-in-implementation', () => {
  test('flags direct throw inside blaze body', () => {
    const code = `
trail("entity.show", {
  blaze: async (input, ctx) => {
    throw new Error("boom");
  }
})`;
    const diagnostics = noThrowInImplementation.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.rule).toBe('no-throw-in-implementation');
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('allows Result.err() in blaze body', () => {
    const code = `
trail("entity.show", {
  blaze: async (input, ctx) => {
    return Result.err(new NotFoundError("not found"));
  }
})`;
    const diagnostics = noThrowInImplementation.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('does not flag throw inside a nested .map() callback', () => {
    const code = `
trail("demo", {
  blaze: async () => {
    [1].map(() => {
      throw new Error("boom");
    });
    return Result.ok({ ok: true });
  }
})`;
    const diagnostics = noThrowInImplementation.check(code, TEST_FILE);
    expect(diagnostics).toHaveLength(0);
  });

  test('does not flag throw inside a nested .filter() callback', () => {
    const code = `
trail("demo", {
  blaze: async () => {
    [1].filter(() => {
      throw new Error("boom");
    });
    return Result.ok({ ok: true });
  }
})`;
    const diagnostics = noThrowInImplementation.check(code, TEST_FILE);
    expect(diagnostics).toHaveLength(0);
  });

  test('does not flag throw inside a nested function declaration', () => {
    const code = `
trail("demo", {
  blaze: async () => {
    function helper() {
      throw new Error("boom");
    }
    return Result.ok({ ok: true });
  }
})`;
    const diagnostics = noThrowInImplementation.check(code, TEST_FILE);
    expect(diagnostics).toHaveLength(0);
  });

  test('still flags direct throw alongside a safe nested callback', () => {
    const code = `
trail("demo", {
  blaze: async () => {
    [1].map(() => {
      throw new Error("inner — allowed");
    });
    throw new Error("outer — flagged");
  }
})`;
    const diagnostics = noThrowInImplementation.check(code, TEST_FILE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-throw-in-implementation');
  });
});
