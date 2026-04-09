import { describe, expect, test } from 'bun:test';

import { createTrailContext } from '@ontrails/core';

import { wrapRule } from '../trails/wrap-rule.js';
import type { ProjectAwareWardenRule } from '../rules/types.js';

describe('wrapRule', () => {
  test('preserves undefined knownResourceIds and defaults knownTrailIds to empty set', async () => {
    let capturedContext:
      | {
          readonly knownResourceIds?: ReadonlySet<string>;
          readonly knownTrailIds?: ReadonlySet<string>;
        }
      | undefined;

    const rule: ProjectAwareWardenRule = {
      check: () => [],
      checkWithContext: (_sourceCode, _filePath, context) => {
        capturedContext = context;
        return [];
      },
      description: 'dummy rule',
      name: 'dummy-rule',
      severity: 'error',
    };

    const wrapped = wrapRule({ examples: [], rule });
    const result = await wrapped.blaze(
      { filePath: 'entity.ts', sourceCode: '' },
      createTrailContext()
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ diagnostics: [] });
    expect(capturedContext).toEqual({
      knownResourceIds: undefined,
      knownTrailIds: new Set<string>(),
    });
  });
});
