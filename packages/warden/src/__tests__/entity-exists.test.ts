import { describe, expect, test } from 'bun:test';

import { entityExists } from '../rules/entity-exists.js';

const TEST_FILE = 'entity.ts';

describe('entity-exists', () => {
  describe('local declarations', () => {
    test('passes when a locally declared entity exists', () => {
      const code = `
import { Result, entity, trail } from '@ontrails/core';
import { z } from 'zod';

const user = entity('user', {
  id: z.string().uuid(),
}, { identity: 'id' });

trail('user.create', {
  entities: [user],
  implementation: async () => Result.ok({ ok: true }),
});
`;

      expect(entityExists.check(code, TEST_FILE)).toEqual([]);
    });

    test('keeps local entity declarations when project context is present', () => {
      const code = `
import { Result, entity, trail } from '@ontrails/core';
import { z } from 'zod';

const user = entity('user', {
  id: z.string().uuid(),
}, { identity: 'id' });

trail('user.create', {
  entities: [user],
  implementation: async () => Result.ok({ ok: true }),
});
`;

      expect(
        entityExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set<string>(),
          knownTrailIds: new Set(['user.create']),
        })
      ).toEqual([]);
    });
  });

  describe('named imports', () => {
    test('flags a missing entity declaration', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import { user } from './entities';

trail('user.create', {
  entities: [user],
  implementation: async () => Result.ok({ ok: true }),
});
`;

      const diagnostics = entityExists.checkWithContext(code, TEST_FILE, {
        knownEntityIds: new Set<string>(),
        knownTrailIds: new Set(['user.create']),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('entity-exists');
      expect(diagnostics[0]?.message).toContain('user');
      expect(diagnostics[0]?.message).toContain("entity('user'");
      expect(diagnostics[0]?.message).toContain('include it in the topo');
    });

    test('resolves aliased imports to the original entity name', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import { user as userModel } from './entities';

trail('user.create', {
  entities: [userModel],
  implementation: async () => Result.ok({ ok: true }),
});
`;

      expect(
        entityExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['user']),
          knownTrailIds: new Set(['user.create']),
        })
      ).toEqual([]);
    });

    test('passes when project context includes an imported entity', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import { user } from './entities';

trail('user.create', {
  entities: [user],
  implementation: async () => Result.ok({ ok: true }),
});
`;

      expect(
        entityExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['user']),
          knownTrailIds: new Set(['user.create']),
        })
      ).toEqual([]);
    });
  });

  describe('default imports', () => {
    test('flags missing default-imported entity declarations', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import userModel from './entities';

trail('user.create', {
  entities: [userModel],
  implementation: async () => Result.ok({ ok: true }),
});
`;

      const diagnostics = entityExists.checkWithContext(code, TEST_FILE, {
        knownEntityIds: new Set<string>(),
        knownTrailIds: new Set(['user.create']),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('entity-exists');
      expect(diagnostics[0]?.message).toContain('userModel');
    });
  });

  describe('namespace imports', () => {
    test('flags missing namespace-imported entity declarations', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import * as entities from './entities';

trail('user.create', {
  entities: [entities.user],
  implementation: async () => Result.ok({ ok: true }),
});
`;

      const diagnostics = entityExists.checkWithContext(code, TEST_FILE, {
        knownEntityIds: new Set<string>(),
        knownTrailIds: new Set(['user.create']),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('entity-exists');
      expect(diagnostics[0]?.message).toContain('user');
    });

    test('resolves namespace-imported entity declarations when known', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import * as entities from './entities';

trail('user.create', {
  entities: [entities.user],
  implementation: async () => Result.ok({ ok: true }),
});
`;

      expect(
        entityExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set(['user']),
          knownTrailIds: new Set(['user.create']),
        })
      ).toEqual([]);
    });

    test('ignores namespace member access when receiver is shadowed by a local binding', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import * as entities from './entities';

function makeTrail() {
  const entities = { user: 'not-a-entity' };
  return trail('user.create', {
    entities: [entities.user],
    implementation: async () => Result.ok({ ok: true }),
  });
}

makeTrail();
`;

      // The trail's \`entities: [entities.user]\` refers to a local
      // \`const entities = ...\`, not the namespace import, so no
      // missing-entity diagnostic should be produced.
      expect(
        entityExists.checkWithContext(code, TEST_FILE, {
          knownEntityIds: new Set<string>(),
          knownTrailIds: new Set(['user.create']),
        })
      ).toEqual([]);
    });
  });
});
