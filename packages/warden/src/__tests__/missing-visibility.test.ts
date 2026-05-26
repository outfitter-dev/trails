import { describe, expect, test } from 'bun:test';

import { missingVisibility } from '../rules/missing-visibility.js';

const TEST_FILE = 'entity.ts';

describe('missing-visibility', () => {
  test('warns when a composed trail has required composeInput but remains public', () => {
    const code = `
trail('entity.resolve', {
  composeInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = missingVisibility.checkWithContext(code, TEST_FILE, {
      composeTargetTrailIds: new Set(['entity.resolve']),
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
  composeInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

      expect(
        missingVisibility.checkWithContext(code, TEST_FILE, {
          composeTargetTrailIds: new Set(['entity.resolve']),
          knownTrailIds: new Set(['entity.resolve']),
        })
      ).toEqual([]);
    });

    test('does not false-positive on string values containing "internal: true"', () => {
      const code = `
trail('entity.resolve', {
  meta: { description: "this has internal: true in it" },
  composeInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

      const diagnostics = missingVisibility.checkWithContext(code, TEST_FILE, {
        composeTargetTrailIds: new Set(['entity.resolve']),
        knownTrailIds: new Set(['entity.resolve']),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('missing-visibility');
    });
  });

  test('stays quiet when the composed trail is already internal', () => {
    const code = `
trail('entity.resolve', {
  visibility: 'internal',
  composeInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

    expect(
      missingVisibility.checkWithContext(code, TEST_FILE, {
        composeTargetTrailIds: new Set(['entity.resolve']),
        knownTrailIds: new Set(['entity.resolve']),
      })
    ).toEqual([]);
  });

  test('stays quiet when composeInput fields are optional', () => {
    const code = `
trail('entity.resolve', {
  composeInput: z.object({ forkedFrom: z.string().optional() }),
  blaze: async () => Result.ok({}),
});
`;

    expect(
      missingVisibility.checkWithContext(code, TEST_FILE, {
        composeTargetTrailIds: new Set(['entity.resolve']),
        knownTrailIds: new Set(['entity.resolve']),
      })
    ).toEqual([]);
  });

  test('stays quiet when the trail is not composed', () => {
    const code = `
trail('entity.resolve', {
  composeInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});
`;

    expect(missingVisibility.check(code, TEST_FILE)).toEqual([]);
  });
});
