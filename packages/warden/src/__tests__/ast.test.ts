import { describe, expect, test } from 'bun:test';

import { deriveContourIdentifierName } from '../rules/ast.js';

describe('deriveContourIdentifierName', () => {
  test('supports the common *Contour binding suffix when resolving known contours', () => {
    expect(
      deriveContourIdentifierName(
        'userContour',
        new Map<string, string>(),
        new Set(['user'])
      )
    ).toBe('user');
  });

  test('prefers exact contour ids over the *Contour fallback', () => {
    expect(
      deriveContourIdentifierName(
        'userContour',
        new Map<string, string>(),
        new Set(['user', 'userContour'])
      )
    ).toBe('userContour');
  });
});
