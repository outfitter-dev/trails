import { describe, expect, test } from 'bun:test';

import { referenceExists } from '../rules/reference-exists.js';

const TEST_FILE = 'contours.ts';

describe('reference-exists', () => {
  describe('local references', () => {
    test('passes when a local contour reference exists', () => {
      const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';

const user = contour('user', {
  id: z.string().uuid(),
}, { identity: 'id' });

const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

      expect(referenceExists.check(code, TEST_FILE)).toEqual([]);
    });

    test('keeps local contour definitions when project context is present', () => {
      const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';

const user = contour('user', {
  id: z.string().uuid(),
}, { identity: 'id' });

const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownContourIds: new Set(['gist']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });
  });

  describe('named imports', () => {
    test('flags a missing contour reference target', () => {
      const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownContourIds: new Set(['gist']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('reference-exists');
      expect(diagnostics[0]?.message).toContain('user');
    });

    test('resolves aliased imports to the original contour id', () => {
      const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';
import { user as userModel } from './user';

const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: userModel.id(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownContourIds: new Set(['gist', 'user']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toEqual([]);
    });

    test('passes when project context includes an imported contour', () => {
      const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownContourIds: new Set(['gist', 'user']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });

    test('flags a missing wrapped contour reference target', () => {
      const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id().nullish(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownContourIds: new Set(['gist']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('reference-exists');
      expect(diagnostics[0]?.message).toContain('user');
    });
  });

  describe('default imports', () => {
    test('flags missing default-imported contour references', () => {
      const code = `
import { contour } from '@ontrails/core';
import userModel from './user';

const gist = contour('gist', {
  id: 'x',
  ownerId: userModel.id(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownContourIds: new Set(['gist']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('reference-exists');
      expect(diagnostics[0]?.message).toContain('userModel');
    });

    test('resolves default-imported contour references when known', () => {
      const code = `
import { contour } from '@ontrails/core';
import user from './user';

const gist = contour('gist', {
  id: 'x',
  ownerId: user.id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownContourIds: new Set(['gist', 'user']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });
  });

  describe('namespace imports', () => {
    test('keeps namespaced inline contour definitions when project context is present', () => {
      const code = `
import * as core from '@ontrails/core';
import { z } from 'zod';

const gist = core.contour('gist', {
  id: z.string().uuid(),
  ownerId: core.contour('user', { id: z.string().uuid() }).id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownContourIds: new Set(['gist']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });

    test('flags missing namespace-imported contour references', () => {
      const code = `
import { contour } from '@ontrails/core';
import * as contours from './contours';

const gist = contour('gist', {
  id: 'x',
  ownerId: contours.user.id(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownContourIds: new Set(['gist']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('reference-exists');
      expect(diagnostics[0]?.message).toContain('user');
    });

    test('resolves namespace-imported contour references when known', () => {
      const code = `
import { contour } from '@ontrails/core';
import * as contours from './contours';

const gist = contour('gist', {
  id: 'x',
  ownerId: contours.user.id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownContourIds: new Set(['gist', 'user']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });

    test('does not flag namespace imports from @ontrails sources', () => {
      const code = `
import * as core from '@ontrails/core';

const gist = core.contour('gist', {
  id: 'x',
  ownerId: core.contour('user', { id: 'y' }).id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownContourIds: new Set(['gist']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });
  });
});
