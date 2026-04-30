import { describe, expect, test } from 'bun:test';

import { unreachableDetourShadowing } from '../rules/unreachable-detour-shadowing.js';

const TEST_FILE = 'detour.ts';

describe('unreachable-detour-shadowing', () => {
  test('passes when the more specific detour is declared first', () => {
    const code = `
trail('entity.save', {
  detours: [
    { on: ConflictError, recover: async () => Result.ok({ winner: 'specific' }) },
    { on: TrailsError, recover: async () => Result.ok({ winner: 'broad' }) },
  ],
});
`;

    expect(unreachableDetourShadowing.check(code, TEST_FILE)).toEqual([]);
  });

  test('flags a later detour shadowed by an earlier broader core error type', () => {
    const code = `
trail('entity.save', {
  detours: [
    { on: TrailsError, recover: async () => Result.ok({ winner: 'broad' }) },
    { on: ConflictError, recover: async () => Result.ok({ winner: 'specific' }) },
  ],
});
`;

    const diagnostics = unreachableDetourShadowing.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('unreachable-detour-shadowing');
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.message).toContain('TrailsError');
    expect(diagnostics[0]?.message).toContain('ConflictError');
  });

  test('flags a later local subclass shadowed by its parent detour', () => {
    const code = `
class StoreConflictError extends ConflictError {}

trail('entity.save', {
  detours: [
    { on: ConflictError, recover: async () => Result.ok({ winner: 'parent' }) },
    { on: StoreConflictError, recover: async () => Result.ok({ winner: 'child' }) },
  ],
});
`;

    const diagnostics = unreachableDetourShadowing.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('ConflictError');
    expect(diagnostics[0]?.message).toContain('StoreConflictError');
  });

  test('flags a later owner-registered subclass shadowed by its parent detour', () => {
    const code = `
trail('entity.permit', {
  detours: [
    { on: PermissionError, recover: async () => Result.ok({ winner: 'permission' }) },
    { on: PermitError, recover: async () => Result.ok({ winner: 'permit' }) },
  ],
});
`;

    const diagnostics = unreachableDetourShadowing.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('PermissionError');
    expect(diagnostics[0]?.message).toContain('PermitError');
  });

  test('flags a later detour shadowed by an earlier DerivationError detour', () => {
    const code = `
trail('entity.derive', {
  detours: [
    { on: DerivationError, recover: async () => Result.ok({ winner: 'broad' }) },
    { on: DerivationError, recover: async () => Result.ok({ winner: 'dup' }) },
  ],
});
`;

    const diagnostics = unreachableDetourShadowing.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('DerivationError');
  });

  test('flags a later detour shadowed by a ClassExpression-bound local subclass', () => {
    const code = `
const StoreConflictError = class extends ConflictError {};

trail('entity.save', {
  detours: [
    { on: ConflictError, recover: async () => Result.ok({ winner: 'parent' }) },
    { on: StoreConflictError, recover: async () => Result.ok({ winner: 'child' }) },
  ],
});
`;

    const diagnostics = unreachableDetourShadowing.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('ConflictError');
    expect(diagnostics[0]?.message).toContain('StoreConflictError');
  });

  test('tolerates sparse holes in the detours array', () => {
    const code = `
trail('entity.save', {
  detours: [
    ,
    { on: TrailsError, recover: async () => Result.ok({ winner: 'broad' }) },
    ,
    { on: ConflictError, recover: async () => Result.ok({ winner: 'specific' }) },
  ],
});
`;

    let diagnostics: readonly { message: string }[] = [];
    expect(() => {
      diagnostics = unreachableDetourShadowing.check(code, TEST_FILE);
    }).not.toThrow();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('TrailsError');
    expect(diagnostics[0]?.message).toContain('ConflictError');
  });

  test('does not flag unrelated sibling error types', () => {
    const code = `
trail('entity.save', {
  detours: [
    { on: ConflictError, recover: async () => Result.ok({ winner: 'conflict' }) },
    { on: ValidationError, recover: async () => Result.ok({ winner: 'validation' }) },
  ],
});
`;

    expect(unreachableDetourShadowing.check(code, TEST_FILE)).toEqual([]);
  });
});
