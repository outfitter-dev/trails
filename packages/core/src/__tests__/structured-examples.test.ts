import { describe, expect, test } from 'bun:test';
import {
  deriveStructuredSignalExamples,
  deriveStructuredTrailExamples,
} from '../structured-examples.js';
import { signal } from '../signal.js';
import type { TrailExample } from '../trail.js';
import { z } from 'zod';

const okExample = (
  overrides: Partial<TrailExample<unknown, unknown>> = {}
): TrailExample<unknown, unknown> => ({
  input: { name: 'ada' },
  name: 'ok',
  ...overrides,
});

describe('deriveStructuredTrailExamples', () => {
  test('derives plain JSON-serializable inputs', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ expected: { ok: true } }),
    ]);
    expect(derived).toBeDefined();
    expect(derived?.[0]?.input).toEqual({ name: 'ada' });
    expect(derived?.[0]?.expected).toEqual({ ok: true });
    expect(derived?.[0]?.kind).toBe('success');
  });

  test('drops examples whose input contains a function leaf', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ input: { fn: () => 'nope' } }),
    ]);
    expect(derived).toBeUndefined();
  });

  test('drops examples whose input contains a nested symbol leaf', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ input: { meta: { token: Symbol('secret') } } }),
    ]);
    expect(derived).toBeUndefined();
  });

  test('drops examples whose expected contains a function leaf', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ expected: [() => 'nope'] }),
    ]);
    expect(derived).toBeUndefined();
  });

  test('drops examples whose input contains a BigInt leaf', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ input: { count: 1n } }),
    ]);
    expect(derived).toBeUndefined();
  });

  test('drops examples whose input contains a Date leaf', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ input: { createdAt: new Date('2024-01-01') } }),
    ]);
    expect(derived).toBeUndefined();
  });

  test('drops examples whose input contains a RegExp leaf', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ input: { pattern: /^x$/ } }),
    ]);
    expect(derived).toBeUndefined();
  });

  test('drops examples whose input contains a Map leaf', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ input: { lookup: new Map([['k', 'v']]) } }),
    ]);
    expect(derived).toBeUndefined();
  });

  test('drops examples whose input contains a Set leaf', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ input: { tags: new Set(['a', 'b']) } }),
    ]);
    expect(derived).toBeUndefined();
  });

  test('preserves examples with undefined optional fields', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({ input: { name: 'ada', nickname: undefined } }),
    ]);
    expect(derived).toBeDefined();
    expect(derived?.[0]?.input).toEqual({ name: 'ada' });
  });

  test('derives signal assertions using stable signal ids', () => {
    const profileUpdated = signal('profile.updated', {
      payload: z.object({ id: z.string(), revision: z.number() }),
    });
    const derived = deriveStructuredTrailExamples([
      okExample({
        signals: [
          {
            payloadMatch: { id: 'u1' },
            signal: profileUpdated,
          },
          {
            payload: { id: 'audit-1' },
            signal: 'audit.logged',
            times: 2,
          },
        ],
      }),
    ]);

    expect(derived?.[0]?.signals).toEqual([
      {
        payloadMatch: { id: 'u1' },
        signalId: 'profile.updated',
      },
      {
        payload: { id: 'audit-1' },
        signalId: 'audit.logged',
        times: 2,
      },
    ]);
  });

  test('drops examples whose signal assertions are not JSON serializable', () => {
    const derived = deriveStructuredTrailExamples([
      okExample({
        signals: [
          {
            payload: { id: 1n },
            signal: 'profile.updated',
          },
        ],
      }),
    ]);

    expect(derived).toBeUndefined();
  });
});

describe('deriveStructuredSignalExamples', () => {
  test('derives valid payloads', () => {
    const derived = deriveStructuredSignalExamples([{ event: 'sent' }]);
    expect(derived?.[0]?.payload).toEqual({ event: 'sent' });
    expect(derived?.[0]?.kind).toBe('payload');
  });

  test('drops payloads with non-serializable leaves', () => {
    const derived = deriveStructuredSignalExamples([
      { cb: () => {}, event: 'sent' },
    ]);
    expect(derived).toBeUndefined();
  });
});
