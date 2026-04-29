import { describe, expect, test } from 'bun:test';
import {
  deriveStructuredSignalExamples,
  deriveStructuredTrailExamples,
} from '../structured-examples.js';
import type { TrailExample } from '../trail.js';

const okExample = (
  overrides: Partial<TrailExample<unknown, unknown>> = {}
): TrailExample<unknown, unknown> => ({
  input: { name: 'ada' },
  name: 'ok',
  ...overrides,
});

describe('deriveStructuredTrailExamples', () => {
  test('projects plain JSON-serializable inputs', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ expected: { ok: true } }),
    ]);
    expect(projected).toBeDefined();
    expect(projected?.[0]?.input).toEqual({ name: 'ada' });
    expect(projected?.[0]?.expected).toEqual({ ok: true });
    expect(projected?.[0]?.kind).toBe('success');
  });

  test('drops examples whose input contains a function leaf', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ input: { fn: () => 'nope' } }),
    ]);
    expect(projected).toBeUndefined();
  });

  test('drops examples whose input contains a nested symbol leaf', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ input: { meta: { token: Symbol('secret') } } }),
    ]);
    expect(projected).toBeUndefined();
  });

  test('drops examples whose expected contains a function leaf', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ expected: [() => 'nope'] }),
    ]);
    expect(projected).toBeUndefined();
  });

  test('drops examples whose input contains a BigInt leaf', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ input: { count: 1n } }),
    ]);
    expect(projected).toBeUndefined();
  });

  test('drops examples whose input contains a Date leaf', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ input: { createdAt: new Date('2024-01-01') } }),
    ]);
    expect(projected).toBeUndefined();
  });

  test('drops examples whose input contains a RegExp leaf', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ input: { pattern: /^x$/ } }),
    ]);
    expect(projected).toBeUndefined();
  });

  test('drops examples whose input contains a Map leaf', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ input: { lookup: new Map([['k', 'v']]) } }),
    ]);
    expect(projected).toBeUndefined();
  });

  test('drops examples whose input contains a Set leaf', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ input: { tags: new Set(['a', 'b']) } }),
    ]);
    expect(projected).toBeUndefined();
  });

  test('preserves examples with undefined optional fields', () => {
    const projected = deriveStructuredTrailExamples([
      okExample({ input: { name: 'ada', nickname: undefined } }),
    ]);
    expect(projected).toBeDefined();
    expect(projected?.[0]?.input).toEqual({ name: 'ada' });
  });
});

describe('deriveStructuredSignalExamples', () => {
  test('projects valid payloads', () => {
    const projected = deriveStructuredSignalExamples([{ event: 'sent' }]);
    expect(projected?.[0]?.payload).toEqual({ event: 'sent' });
    expect(projected?.[0]?.kind).toBe('payload');
  });

  test('drops payloads with non-serializable leaves', () => {
    const projected = deriveStructuredSignalExamples([
      { cb: () => {}, event: 'sent' },
    ]);
    expect(projected).toBeUndefined();
  });
});
