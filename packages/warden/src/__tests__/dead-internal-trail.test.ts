import { describe, expect, test } from 'bun:test';

import { deadInternalTrail } from '../rules/dead-internal-trail.js';

const TEST_FILE = 'entity.ts';

describe('dead-internal-trail', () => {
  test('warns when an internal trail is never crossed and has no on: activation', () => {
    const code = `
trail('entity.sync', {
  visibility: 'internal',
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = deadInternalTrail.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('dead-internal-trail');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('entity.sync');
  });

  test('stays quiet when another trail crosses the internal trail in the same file', () => {
    const code = `
trail('entity.public', {
  crosses: ['entity.sync'],
  blaze: async (_input, ctx) => ctx.cross('entity.sync', {}),
});

trail('entity.sync', {
  visibility: 'internal',
  blaze: async () => Result.ok({}),
});
`;

    expect(deadInternalTrail.check(code, TEST_FILE)).toEqual([]);
  });

  test('stays quiet when project context marks the trail as crossed elsewhere', () => {
    const code = `
trail('entity.sync', {
  visibility: 'internal',
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = deadInternalTrail.checkWithContext(code, TEST_FILE, {
      crossTargetTrailIds: new Set(['entity.sync']),
      knownTrailIds: new Set(['entity.public', 'entity.sync']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet when the internal trail has on: activation', () => {
    const code = `
trail('entity.audit', {
  visibility: 'internal',
  on: ['entity.created'],
  blaze: async () => Result.ok({}),
});
`;

    expect(deadInternalTrail.check(code, TEST_FILE)).toEqual([]);
  });

  test('stays quiet when on: is a module-level identifier reference', () => {
    const code = `
const activationSignals = ['entity.created', 'entity.updated'];

trail('entity.audit', {
  visibility: 'internal',
  on: activationSignals,
  blaze: async () => Result.ok({}),
});
`;

    expect(deadInternalTrail.check(code, TEST_FILE)).toEqual([]);
  });
});
