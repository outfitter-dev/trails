import { describe, expect, test } from 'bun:test';

import { resourceIdGrammar } from '../rules/resource-id-grammar.js';

const TEST_FILE = 'resource.ts';

describe('resource-id-grammar', () => {
  test('passes when resource ids use dots or dashes only', () => {
    const code = `
import { resource, Result } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({}),
});
`;

    expect(resourceIdGrammar.check(code, TEST_FILE)).toEqual([]);
  });

  test('flags resource ids containing a colon', () => {
    const code = `
import { resource, Result } from '@ontrails/core';

const db = resource('billing:primary', {
  create: () => Result.ok({}),
});
`;

    const diagnostics = resourceIdGrammar.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('resource-id-grammar');
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.message).toContain('billing:primary');
  });

  test('skips test files', () => {
    const code = `
import { resource, Result } from '@ontrails/core';

const db = resource('billing:primary', {
  create: () => Result.ok({}),
});
`;

    expect(
      resourceIdGrammar.check(code, 'src/__tests__/resource-id-grammar.test.ts')
    ).toEqual([]);
  });
});
