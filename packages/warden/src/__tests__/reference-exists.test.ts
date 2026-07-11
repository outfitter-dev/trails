import { describe, expect, test } from 'bun:test';

import { referenceExists } from '../rules/reference-exists.js';

const TEST_FILE = 'entities.ts';

describe('reference-exists', () => {
  describe('local references', () => {
    test('passes when a local entity reference exists', () => {
      const code = `
import { entity } from '@ontrails/core';
import { z } from 'zod';

const user = entity('user', {
  id: z.string().uuid(),
}, { identity: 'id' });

const gist = entity('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

      expect(referenceExists.check(code, TEST_FILE)).toEqual([]);
    });

    test('keeps local entity definitions when project context is present', () => {
      const code = `
import { entity } from '@ontrails/core';
import { z } from 'zod';

const user = entity('user', {
  id: z.string().uuid(),
}, { identity: 'id' });

const gist = entity('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['gist']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });
  });

  describe('named imports', () => {
    test('flags a missing entity reference target', () => {
      const code = `
import { entity } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

const gist = entity('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownEntityIds: new Set(['gist']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('reference-exists');
      expect(diagnostics[0]?.message).toContain('user');
      expect(diagnostics[0]?.message).toContain("entity('user'");
      expect(diagnostics[0]?.message).toContain('include it in the topo');
    });

    test('resolves aliased imports to the original entity id', () => {
      const code = `
import { entity } from '@ontrails/core';
import { z } from 'zod';
import { user as userModel } from './user';

const gist = entity('gist', {
  id: z.string().uuid(),
  ownerId: userModel.id(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownEntityIds: new Set(['gist', 'user']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toEqual([]);
    });

    test('passes when project context includes an imported entity', () => {
      const code = `
import { entity } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

const gist = entity('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['gist', 'user']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });

    test('flags a missing wrapped entity reference target', () => {
      const code = `
import { entity } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

const gist = entity('gist', {
  id: z.string().uuid(),
  ownerId: user.id().nullish(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownEntityIds: new Set(['gist']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('reference-exists');
      expect(diagnostics[0]?.message).toContain('user');
    });
  });

  describe('default imports', () => {
    test('flags missing default-imported entity references', () => {
      const code = `
import { entity } from '@ontrails/core';
import userModel from './user';

const gist = entity('gist', {
  id: 'x',
  ownerId: userModel.id(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownEntityIds: new Set(['gist']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('reference-exists');
      expect(diagnostics[0]?.message).toContain('userModel');
    });

    test('resolves default-imported entity references when known', () => {
      const code = `
import { entity } from '@ontrails/core';
import user from './user';

const gist = entity('gist', {
  id: 'x',
  ownerId: user.id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['gist', 'user']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });
  });

  describe('namespace imports', () => {
    test('keeps namespaced inline entity definitions when project context is present', () => {
      const code = `
import * as core from '@ontrails/core';
import { z } from 'zod';

const gist = core.entity('gist', {
  id: z.string().uuid(),
  ownerId: core.entity('user', { id: z.string().uuid() }).id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['gist']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });

    test('flags missing namespace-imported entity references', () => {
      const code = `
import { entity } from '@ontrails/core';
import * as entities from './entities';

const gist = entity('gist', {
  id: 'x',
  ownerId: entities.user.id(),
}, { identity: 'id' });
`;

      const diagnostics = referenceExists.checkWithContext(code, TEST_FILE, {
        knownEntityIds: new Set(['gist']),
        knownTrailIds: new Set<string>(),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('reference-exists');
      expect(diagnostics[0]?.message).toContain('user');
    });

    test('resolves namespace-imported entity references when known', () => {
      const code = `
import { entity } from '@ontrails/core';
import * as entities from './entities';

const gist = entity('gist', {
  id: 'x',
  ownerId: entities.user.id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['gist', 'user']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });

    test('ignores namespace member access when receiver is shadowed by a function parameter', () => {
      const code = `
import { entity } from '@ontrails/core';
import * as entities from './entities';

function buildGist(entities: { user: { id: () => unknown } }) {
  return entity('gist', {
    id: 'x',
    ownerId: entities.user.id(),
  }, { identity: 'id' });
}
`;

      // The \`entities\` in \`entities.user.id()\` is the function parameter,
      // not the namespace import, so no missing-reference diagnostic should
      // be produced.
      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['gist']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });

    test('does not flag namespace imports from @ontrails sources', () => {
      const code = `
import * as core from '@ontrails/core';

const gist = core.entity('gist', {
  id: 'x',
  ownerId: core.entity('user', { id: 'y' }).id(),
}, { identity: 'id' });
`;

      expect(
        referenceExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['gist']),
          knownTrailIds: new Set<string>(),
        })
      ).toEqual([]);
    });
  });
});
