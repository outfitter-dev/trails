import { describe, expect, test } from 'bun:test';

import { intentPropagation } from '../rules/intent-propagation.js';

const TEST_FILE = 'entity.ts';

describe('intent-propagation', () => {
  test('warns when a read trail composes a write trail', () => {
    const code = `
trail('entity.read', {
  intent: 'read',
  composes: ['entity.refresh'],
  implementation: async (_input, ctx) => ctx.compose('entity.refresh', {}),
});

trail('entity.refresh', {
  intent: 'write',
  implementation: async () => Result.ok({}),
});
`;

    const diagnostics = intentPropagation.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('intent-propagation');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('entity.refresh');
    expect(diagnostics[0]?.message).toContain("intent: 'write'");
  });

  test('warns when project context resolves a composed trail to destroy intent', () => {
    const code = `
trail('entity.read', {
  intent: 'read',
  composes: ['entity.delete'],
  implementation: async (_input, ctx) => ctx.compose('entity.delete', {}),
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

  test('stays quiet when a read trail composes another read trail', () => {
    const code = `
trail('entity.read', {
  intent: 'read',
  composes: ['entity.lookup'],
  implementation: async (_input, ctx) => ctx.compose('entity.lookup', {}),
});

trail('entity.lookup', {
  intent: 'read',
  implementation: async () => Result.ok({}),
});
`;

    expect(intentPropagation.check(code, TEST_FILE)).toEqual([]);
  });

  test('warns when namespaced core.trail(...) read composes a write trail', () => {
    // Regression guard for TRL-343: the shared findTrailDefinitions helper
    // must recognize `core.trail("id", { ... })` as a trail definition, not
    // just bare `trail("id", { ... })`. Before the fix these definitions were
    // silently skipped and this rule stayed quiet on namespaced-import files.
    //
    // Per TRL-347 the namespace receiver must resolve to an `@ontrails/*`
    // import — the `import * as core from '@ontrails/core'` below is what
    // licenses the `core.trail(...)` recognition.
    const code = `
import * as core from '@ontrails/core';

core.trail('entity.read', {
  intent: 'read',
  composes: ['entity.refresh'],
  implementation: async (_input, ctx) => ctx.compose('entity.refresh', {}),
});

core.trail('entity.refresh', {
  intent: 'write',
  implementation: async () => Result.ok({}),
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
  composes: ['entity.delete'],
  implementation: async (_input, ctx) => ctx.compose('entity.delete', {}),
});

trail('entity.delete', {
  intent: 'destroy',
  implementation: async () => Result.ok({}),
});
`;

    expect(intentPropagation.check(code, TEST_FILE)).toEqual([]);
  });
});
