import { describe, expect, test } from 'bun:test';

import { createTrailContext } from '@ontrails/core';

import { noThrowInImplementation } from '../rules/no-throw-in-implementation.js';
import { wrapRule } from '../trails/wrap-rule.js';
import type { ProjectAwareWardenRule } from '../rules/types.js';

describe('wrapRule', () => {
  test('copies built-in rule metadata into trail meta', () => {
    const wrapped = wrapRule({ examples: [], rule: noThrowInImplementation });

    expect(wrapped.meta?.category).toBe('governance');
    expect(wrapped.meta?.severity).toBe('error');
    expect(wrapped.meta?.warden).toMatchObject({
      lifecycle: { state: 'durable' },
      tier: 'source-static',
    });
  });

  test('omits absent resource ids and defaults knownTrailIds to empty set', async () => {
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
      knownTrailIds: new Set<string>(),
    });
    expect(capturedContext?.knownResourceIds).toBeUndefined();
  });
});
