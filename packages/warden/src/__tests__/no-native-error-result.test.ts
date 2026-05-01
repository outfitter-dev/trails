import { describe, expect, test } from 'bun:test';

import { noNativeErrorResult } from '../rules/no-native-error-result.js';

const TEST_FILE = 'src/trails/entity.ts';

describe('no-native-error-result', () => {
  test('flags Result.err(new Error(...))', () => {
    const code = `
import { Result } from '@ontrails/core';

export const load = () => Result.err(new Error('failed'));
`;

    const diagnostics = noNativeErrorResult.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-native-error-result');
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.message).toContain('TrailsError');
  });

  test('flags namespaced Result.err(new Error(...))', () => {
    const code = `
import * as core from '@ontrails/core';

export const load = () => core.Result.err(new Error('failed'));
`;

    const diagnostics = noNativeErrorResult.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
  });

  test('allows specific TrailsError subclasses', () => {
    const code = `
import { InternalError, Result } from '@ontrails/core';

export const load = () => Result.err(new InternalError('failed'));
`;

    expect(noNativeErrorResult.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not flag constructor-boundary throws', () => {
    const code = `
export const load = () => {
  throw new Error('failed');
};
`;

    expect(noNativeErrorResult.check(code, TEST_FILE)).toEqual([]);
  });

  test('ignores framework-internal test helpers', () => {
    const code = `
import { Result } from '@ontrails/core';

export const inject = () => Result.err(new Error('AlreadyExistsError'));
`;

    const diagnostics = noNativeErrorResult.check(
      code,
      '/workspace/packages/testing/src/crosses.ts'
    );

    expect(diagnostics).toEqual([]);
  });
});
