import { describe, expect, test } from 'bun:test';

import { contourExists } from '../rules/contour-exists.js';

const TEST_FILE = 'entity.ts';

describe('contour-exists', () => {
  describe('local declarations', () => {
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

    test('keeps local contour declarations when project context is present', () => {
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

      expect(
        contourExists.checkWithContext(code, TEST_FILE, {
          knownContourIds: new Set<string>(),
          knownTrailIds: new Set(['user.create']),
        })
      ).toEqual([]);
    });
  });

  describe('named imports', () => {
    test('flags a missing contour declaration', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import { user } from './contours';

trail('user.create', {
  contours: [user],
  blaze: async () => Result.ok({ ok: true }),
});
`;

      const diagnostics = contourExists.checkWithContext(code, TEST_FILE, {
        knownContourIds: new Set<string>(),
        knownTrailIds: new Set(['user.create']),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('contour-exists');
      expect(diagnostics[0]?.message).toContain('user');
    });

    test('resolves aliased imports to the original contour name', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import { user as userModel } from './contours';

trail('user.create', {
  contours: [userModel],
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

  describe('default imports', () => {
    test('flags missing default-imported contour declarations', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import userModel from './contours';

trail('user.create', {
  contours: [userModel],
  blaze: async () => Result.ok({ ok: true }),
});
`;

      const diagnostics = contourExists.checkWithContext(code, TEST_FILE, {
        knownContourIds: new Set<string>(),
        knownTrailIds: new Set(['user.create']),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('contour-exists');
      expect(diagnostics[0]?.message).toContain('userModel');
    });
  });

  describe('namespace imports', () => {
    test('flags missing namespace-imported contour declarations', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import * as contours from './contours';

trail('user.create', {
  contours: [contours.user],
  blaze: async () => Result.ok({ ok: true }),
});
`;

      const diagnostics = contourExists.checkWithContext(code, TEST_FILE, {
        knownContourIds: new Set<string>(),
        knownTrailIds: new Set(['user.create']),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('contour-exists');
      expect(diagnostics[0]?.message).toContain('user');
    });

    test('resolves namespace-imported contour declarations when known', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import * as contours from './contours';

trail('user.create', {
  contours: [contours.user],
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
});
