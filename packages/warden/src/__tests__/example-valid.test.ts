import { describe, expect, test } from 'bun:test';

import { exampleValid } from '../rules/example-valid.js';

const TEST_FILE = 'contours.ts';

describe('example-valid', () => {
  test('passes when contour examples match the schema', () => {
    const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';

const user = contour('user', {
  id: z.string().uuid(),
  name: z.string(),
}, {
  examples: [{
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Ada',
  }],
  identity: 'id',
});
`;

    expect(exampleValid.check(code, TEST_FILE)).toEqual([]);
  });

  test('flags invalid contour examples', () => {
    const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';

const user = contour('user', {
  id: z.string().uuid(),
  name: z.string(),
}, {
  examples: [{
    id: 'not-a-uuid',
    name: 42,
  }],
  identity: 'id',
});
`;

    const diagnostics = exampleValid.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('example-valid');
    expect(diagnostics[0]?.message).toContain('example 0 is invalid');
  });

  test('skips unsupported example expressions instead of guessing', () => {
    const code = `
import { contour } from '@ontrails/core';
import { z } from 'zod';

const buildExample = () => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Ada',
});

const user = contour('user', {
  id: z.string().uuid(),
  name: z.string(),
}, {
  examples: [buildExample()],
  identity: 'id',
});
`;

    expect(exampleValid.check(code, TEST_FILE)).toEqual([]);
  });
});
