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

  test('projects signal assertions using stable signal ids', () => {
    const profileUpdated = signal('profile.updated', {
      payload: z.object({ id: z.string(), revision: z.number() }),
    });
    const projected = deriveStructuredTrailExamples([
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

    expect(projected?.[0]?.signals).toEqual([
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
    const projected = deriveStructuredTrailExamples([
      okExample({
        signals: [
          {
            payload: { id: 1n },
            signal: 'profile.updated',
          },
        ],
      }),
    ]);

    expect(projected).toBeUndefined();
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
