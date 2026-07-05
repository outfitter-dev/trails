import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { isOverlay } from '../overlay.js';

const validOverlay = {
  derive: () => ({ facts: [] }),
  namespace: 'acme',
  schema: z.object({ facts: z.array(z.string()) }).strict(),
};

describe('isOverlay', () => {
  test('accepts a valid overlay with a real zod schema', () => {
    expect(isOverlay(validOverlay)).toBe(true);
  });

  test('rejects null', () => {
    expect(isOverlay(null)).toBe(false);
  });

  test('rejects a missing namespace', () => {
    const { namespace: _namespace, ...withoutNamespace } = validOverlay;
    expect(isOverlay(withoutNamespace)).toBe(false);
  });

  test('rejects a non-function derive', () => {
    expect(isOverlay({ ...validOverlay, derive: 'nope' })).toBe(false);
  });

  test('rejects a schema without safeParse', () => {
    expect(
      isOverlay({
        ...validOverlay,
        schema: { parse: () => ({}) },
      })
    ).toBe(false);
  });
});
