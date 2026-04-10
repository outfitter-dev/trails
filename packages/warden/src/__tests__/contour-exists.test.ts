import { describe, expect, test } from 'bun:test';

import { contourExists } from '../rules/contour-exists.js';

const TEST_FILE = 'entity.ts';

describe('contour-exists', () => {
  test('passes when a locally declared contour exists', () => {
    const code = `
import { Result, contour, trail } from '@ontrails/core';
import { z } from 'zod';

const user = contour('user', {
  id: z.string().uuid(),
}, { identity: 'id' });

trail('user.create', {
  contours: [user],
  blaze: async () => Result.ok({ ok: true }),
});
`;

    expect(contourExists.check(code, TEST_FILE)).toEqual([]);
  });

  test('flags a missing contour declaration', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('user.create', {
  contours: [user],
  blaze: async () => Result.ok({ ok: true }),
});
`;

    const diagnostics = contourExists.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('contour-exists');
    expect(diagnostics[0]?.message).toContain('user');
  });

  test('passes when project context includes an imported contour', () => {
    const code = `
import { Result, trail } from '@ontrails/core';
import { user } from './contours';

trail('user.create', {
  contours: [user],
  blaze: async () => Result.ok({ ok: true }),
});
`;

    expect(
      contourExists.checkWithContext(code, TEST_FILE, {
        knownContourIds: new Set(['user']),
        knownTrailIds: new Set(['user.create']),
      })
    ).toEqual([]);
  });
});
