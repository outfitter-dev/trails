import { describe, expect, test } from 'bun:test';

import { referenceExists } from '../rules/reference-exists.js';

const TEST_FILE = 'contours.ts';

describe('reference-exists', () => {
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

  test('flags a missing contour reference target', () => {
    const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';

const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });
`;

    const diagnostics = referenceExists.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('reference-exists');
    expect(diagnostics[0]?.message).toContain('user');
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
});
