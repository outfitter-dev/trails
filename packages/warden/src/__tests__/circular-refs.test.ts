import { describe, expect, test } from 'bun:test';

import { circularRefs } from '../rules/circular-refs.js';

const TEST_FILE = 'entities.ts';

describe('circular-refs', () => {
  test('passes when entity references are acyclic', () => {
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

    expect(circularRefs.check(code, TEST_FILE)).toEqual([]);
  });

  test('warns on direct local entity cycles', () => {
    const code = `
import { entity } from '@ontrails/core';
import { z } from 'zod';

const user = entity('user', {
  gistId: gist.id(),
  id: z.string().uuid(),
}, { identity: 'id' });

const gist = entity('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

    const diagnostics = circularRefs.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.rule).toBe('circular-refs');
    expect(diagnostics[0]?.message).toContain('user -> gist -> user');
    expect(diagnostics[0]?.message).toContain('Break the cycle');
    expect(diagnostics[0]?.message).toContain('shared shape');
  });

  test('warns on transitive cycles discovered through project context', () => {
    const code = `
import { entity } from '@ontrails/core';
import { z } from 'zod';
import { gist } from './gist';

const user = entity('user', {
  gistId: gist.id(),
  id: z.string().uuid(),
}, { identity: 'id' });
`;

    const diagnostics = circularRefs.checkWithContext(code, TEST_FILE, {
      entityReferencesByName: new Map([
        ['account', ['user']],
        ['gist', ['account']],
      ]),
      knownEntityIds: new Set(['account', 'gist', 'user']),
      knownTrailIds: new Set<string>(),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      'user -> gist -> account -> user'
    );
  });

  test('warns on local cycles formed through wrapped entity id schemas', () => {
    const code = `
import { entity } from '@ontrails/core';
import { z } from 'zod';

const user = entity('user', {
  gistId: gist.id().optional(),
  id: z.string().uuid(),
}, { identity: 'id' });

const gist = entity('gist', {
  id: z.string().uuid(),
  ownerId: user.id().nullable(),
}, { identity: 'id' });
`;

    const diagnostics = circularRefs.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.rule).toBe('circular-refs');
    expect(diagnostics[0]?.message).toContain('user -> gist -> user');
  });

  test('warns on local cycles formed through namespace-imported references', () => {
    const code = `
import { entity } from '@ontrails/core';
import * as entities from './entities';

const user = entity('user', {
  id: 'x',
  gistId: entities.gist.id(),
}, { identity: 'id' });

const gist = entity('gist', {
  id: 'x',
  ownerId: entities.user.id(),
}, { identity: 'id' });
`;

    const diagnostics = circularRefs.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.rule).toBe('circular-refs');
    expect(diagnostics[0]?.message).toContain('user -> gist -> user');
  });
});
