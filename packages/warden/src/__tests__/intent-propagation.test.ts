import { describe, expect, test } from 'bun:test';

import { intentPropagation } from '../rules/intent-propagation.js';

const TEST_FILE = 'entity.ts';

describe('intent-propagation', () => {
  test('warns when a read trail crosses a write trail', () => {
    const code = `
trail('entity.read', {
  intent: 'read',
  crosses: ['entity.refresh'],
  blaze: async (_input, ctx) => ctx.cross('entity.refresh', {}),
});

trail('entity.refresh', {
  intent: 'write',
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = intentPropagation.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('intent-propagation');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('entity.refresh');
    expect(diagnostics[0]?.message).toContain("intent: 'write'");
  });

  test('warns when project context resolves a crossed trail to destroy intent', () => {
    const code = `
trail('entity.read', {
  intent: 'read',
  crosses: ['entity.delete'],
  blaze: async (_input, ctx) => ctx.cross('entity.delete', {}),
});
`;

    const diagnostics = intentPropagation.checkWithContext(code, TEST_FILE, {
      knownTrailIds: new Set(['entity.delete', 'entity.read']),
      trailIntentsById: new Map([
        ['entity.delete', 'destroy'],
        ['entity.read', 'read'],
      ]),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("intent: 'destroy'");
  });

  test('stays quiet when a read trail crosses another read trail', () => {
    const code = `
trail('entity.read', {
  intent: 'read',
  crosses: ['entity.lookup'],
  blaze: async (_input, ctx) => ctx.cross('entity.lookup', {}),
});

trail('entity.lookup', {
  intent: 'read',
  blaze: async () => Result.ok({}),
});
`;

    expect(intentPropagation.check(code, TEST_FILE)).toEqual([]);
  });

  test('warns when namespaced core.trail(...) read crosses a write trail', () => {
    // Regression guard for TRL-343: the shared findTrailDefinitions helper
    // must recognize `core.trail("id", { ... })` as a trail definition, not
    // just bare `trail("id", { ... })`. Before the fix these definitions were
    // silently skipped and this rule stayed quiet on namespaced-import files.
    const code = `
core.trail('entity.read', {
  intent: 'read',
  crosses: ['entity.refresh'],
  blaze: async (_input, ctx) => ctx.cross('entity.refresh', {}),
});

core.trail('entity.refresh', {
  intent: 'write',
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = intentPropagation.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('entity.refresh');
    expect(diagnostics[0]?.message).toContain("intent: 'write'");
  });

  test('stays quiet when the entry trail is not read-only', () => {
    const code = `
trail('entity.update', {
  intent: 'write',
  crosses: ['entity.delete'],
  blaze: async (_input, ctx) => ctx.cross('entity.delete', {}),
});

trail('entity.delete', {
  intent: 'destroy',
  blaze: async () => Result.ok({}),
});
`;

    expect(intentPropagation.check(code, TEST_FILE)).toEqual([]);
  });
});
