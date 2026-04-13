import { describe, expect, test } from 'bun:test';

import { resolveContourIdentifierName } from '../rules/ast.js';

describe('resolveContourIdentifierName', () => {
  test('supports the common *Contour binding suffix when resolving known contours', () => {
    expect(
      resolveContourIdentifierName(
        'userContour',
        new Map<string, string>(),
        new Set(['user'])
      )
    ).toBe('user');
  });

  test('prefers exact contour ids over the *Contour fallback', () => {
    expect(
      resolveContourIdentifierName(
        'userContour',
        new Map<string, string>(),
        new Set(['user', 'userContour'])
      )
    ).toBe('userContour');
  });
});
