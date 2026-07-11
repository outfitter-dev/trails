import { describe, expect, test } from 'bun:test';

import { deadInternalTrail } from '../rules/dead-internal-trail.js';

const TEST_FILE = 'entity.ts';

describe('dead-internal-trail', () => {
  test('warns when an internal trail is never composed and has no on: activation', () => {
    const code = `
trail('entity.sync', {
  visibility: 'internal',
  implementation: async () => Result.ok({}),
});
`;

    const diagnostics = deadInternalTrail.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('dead-internal-trail');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('entity.sync');
  });

  test('stays quiet when another trail composes the internal trail in the same file', () => {
    const code = `
trail('entity.public', {
  composes: ['entity.sync'],
  implementation: async (_input, ctx) => ctx.compose('entity.sync', {}),
});

trail('entity.sync', {
  visibility: 'internal',
  implementation: async () => Result.ok({}),
});
`;

    expect(deadInternalTrail.check(code, TEST_FILE)).toEqual([]);
  });

  test('stays quiet when project context marks the trail as composed elsewhere', () => {
    const code = `
trail('entity.sync', {
  visibility: 'internal',
  implementation: async () => Result.ok({}),
});
`;

    const diagnostics = deadInternalTrail.checkWithContext(code, TEST_FILE, {
      composeTargetTrailIds: new Set(['entity.sync']),
      knownTrailIds: new Set(['entity.public', 'entity.sync']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet when project context anchors the internal trail in a topo', () => {
    const code = `
trail('entity.sync', {
  visibility: 'internal',
  implementation: async () => Result.ok({}),
});
`;

    const diagnostics = deadInternalTrail.checkWithContext(code, TEST_FILE, {
      knownTrailIds: new Set(['entity.sync']),
      topoTrailIds: new Set(['entity.sync']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet when the internal trail is composed in-file but the project context omits it', () => {
    // Mirrors the regrade tracer case (TRL-843): the project context only
    // collects compose edges from registered app topos, so a package that is
    // scanned but not part of any registered topo contributes a non-empty
    // context set that nonetheless omits its own same-file compose edge. The
    // rule must union the file-local compose evidence with the context set
    // instead of preferring the incomplete context set.
    const code = `
const normalizeExportConstTrail = trail('regrade.literal.normalize-export-const', {
  visibility: 'internal',
  implementation: async () => Result.ok({}),
});

const literalRegradeTrail = trail('regrade.literal.run', {
  composes: [normalizeExportConstTrail],
  implementation: async (_input, ctx) => ctx.compose(normalizeExportConstTrail, {}),
});
`;

    const diagnostics = deadInternalTrail.checkWithContext(code, TEST_FILE, {
      // Non-empty, but omits the internal child id — exactly the topo-path gap.
      composeTargetTrailIds: new Set(['some.other.trail']),
      knownTrailIds: new Set([
        'regrade.literal.run',
        'regrade.literal.normalize-export-const',
      ]),
    });

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet when the internal trail has on: activation', () => {
    const code = `
trail('entity.audit', {
  visibility: 'internal',
  on: ['entity.created'],
  implementation: async () => Result.ok({}),
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
  implementation: async () => Result.ok({}),
});
`;

    expect(deadInternalTrail.check(code, TEST_FILE)).toEqual([]);
  });
});
