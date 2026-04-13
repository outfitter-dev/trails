import { describe, expect, test } from 'bun:test';

import { missingVisibility } from '../rules/missing-visibility.js';

const TEST_FILE = 'entity.ts';

describe('missing-visibility', () => {
  test('warns when a crossed trail has required crossInput but remains public', () => {
    const code = `
trail('entity.resolve', {
  crossInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = missingVisibility.checkWithContext(code, TEST_FILE, {
      crossTargetTrailIds: new Set(['entity.resolve']),
      knownTrailIds: new Set(['entity.resolve']),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('missing-visibility');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('entity.resolve');
    expect(diagnostics[0]?.message).toContain("visibility: 'internal'");
  });

  describe('hasLegacyMetaInternal detection', () => {
    test('treats trail with meta: { internal: true } as internal', () => {
      const code = `
trail('entity.resolve', {
  meta: { internal: true },
  crossInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

      expect(
        missingVisibility.checkWithContext(code, TEST_FILE, {
          crossTargetTrailIds: new Set(['entity.resolve']),
          knownTrailIds: new Set(['entity.resolve']),
        })
      ).toEqual([]);
    });

    test('does not false-positive on string values containing "internal: true"', () => {
      const code = `
trail('entity.resolve', {
  meta: { description: "this has internal: true in it" },
  crossInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

      const diagnostics = missingVisibility.checkWithContext(code, TEST_FILE, {
        crossTargetTrailIds: new Set(['entity.resolve']),
        knownTrailIds: new Set(['entity.resolve']),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('missing-visibility');
    });
  });

  test('stays quiet when the crossed trail is already internal', () => {
    const code = `
trail('entity.resolve', {
  visibility: 'internal',
  crossInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

    expect(
      missingVisibility.checkWithContext(code, TEST_FILE, {
        crossTargetTrailIds: new Set(['entity.resolve']),
        knownTrailIds: new Set(['entity.resolve']),
      })
    ).toEqual([]);
  });

  test('stays quiet when crossInput fields are optional', () => {
    const code = `
trail('entity.resolve', {
  crossInput: z.object({ forkedFrom: z.string().optional() }),
  blaze: async () => Result.ok({}),
});
`;

    expect(
      missingVisibility.checkWithContext(code, TEST_FILE, {
        crossTargetTrailIds: new Set(['entity.resolve']),
        knownTrailIds: new Set(['entity.resolve']),
      })
    ).toEqual([]);
  });

  test('stays quiet when the trail is not crossed', () => {
    const code = `
trail('entity.resolve', {
  crossInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

    expect(missingVisibility.check(code, TEST_FILE)).toEqual([]);
  });
});
