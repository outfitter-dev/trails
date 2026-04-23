import { describe, expect, test } from 'bun:test';

import { noThrowInDetourRecover } from '../rules/no-throw-in-detour-recover.js';

const TEST_FILE = 'detour.ts';

describe('no-throw-in-detour-recover', () => {
  test('flags throw inside an inline detour recover function', () => {
    const code = `
trail("entity.save", {
  detours: [
    {
      on: ConflictError,
      recover: async () => {
        throw new Error("boom");
      },
    },
  ],
  blaze: () => Result.err(new ConflictError("conflict")),
})`;

    const diagnostics = noThrowInDetourRecover.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-throw-in-detour-recover');
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('flags throw inside a detour recover function declaration binding', () => {
    const code = `
async function recoverConflict() {
  throw new Error("boom");
}

trail("entity.save", {
  detours: [
    {
      on: ConflictError,
      recover: recoverConflict,
    },
  ],
  blaze: () => Result.err(new ConflictError("conflict")),
})`;

    const diagnostics = noThrowInDetourRecover.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('detour[0]');
  });

  test('does not flag throw inside a nested callback within recover', () => {
    const code = `
trail("entity.save", {
  detours: [
    {
      on: ConflictError,
      recover: async () => {
        [1].map(() => {
          throw new Error("inner");
        });
        return Result.err(new ConflictError("still conflicting"));
      },
    },
  ],
  blaze: () => Result.err(new ConflictError("conflict")),
})`;

    const diagnostics = noThrowInDetourRecover.check(code, TEST_FILE);

    expect(diagnostics).toEqual([]);
  });

  test('ignores throws outside detour recover functions', () => {
    const code = `
function helper() {
  throw new Error("boom");
}

trail("entity.save", {
  detours: [
    {
      on: ConflictError,
      recover: async () => Result.err(new ConflictError("still conflicting")),
    },
  ],
  blaze: () => Result.err(new ConflictError("conflict")),
})`;

    const diagnostics = noThrowInDetourRecover.check(code, TEST_FILE);

    expect(diagnostics).toEqual([]);
  });
});
