import { describe, expect, test } from 'bun:test';

import { circularRefs } from '../rules/circular-refs.js';

const TEST_FILE = 'contours.ts';

describe('circular-refs', () => {
  test('passes when contour references are acyclic', () => {
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

    expect(circularRefs.check(code, TEST_FILE)).toEqual([]);
  });

  test('warns on direct local contour cycles', () => {
    const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';

const user = contour('user', {
  gistId: gist.id(),
  id: z.string().uuid(),
}, { identity: 'id' });

const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

    const diagnostics = circularRefs.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.rule).toBe('circular-refs');
    expect(diagnostics[0]?.message).toContain('user -> gist -> user');
  });

  test('warns on transitive cycles discovered through project context', () => {
    const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';
import { gist } from './gist';

const user = contour('user', {
  gistId: gist.id(),
  id: z.string().uuid(),
}, { identity: 'id' });
`;

    const diagnostics = circularRefs.checkWithContext(code, TEST_FILE, {
      contourReferencesByName: new Map([
        ['account', ['user']],
        ['gist', ['account']],
      ]),
      knownContourIds: new Set(['account', 'gist', 'user']),
      knownTrailIds: new Set<string>(),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      'user -> gist -> account -> user'
    );
  });

  test('warns on local cycles formed through wrapped contour id schemas', () => {
    const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';

const user = contour('user', {
  gistId: gist.id().optional(),
  id: z.string().uuid(),
}, { identity: 'id' });

const gist = contour('gist', {
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
import { contour } from '@ontrails/core';
import * as contours from './contours';

const user = contour('user', {
  id: 'x',
  gistId: contours.gist.id(),
}, { identity: 'id' });

const gist = contour('gist', {
  id: 'x',
  ownerId: contours.user.id(),
}, { identity: 'id' });
`;

    const diagnostics = circularRefs.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.rule).toBe('circular-refs');
    expect(diagnostics[0]?.message).toContain('user -> gist -> user');
  });
});
