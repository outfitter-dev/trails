import { describe, expect, test } from 'bun:test';

import { signal } from '@ontrails/core';
import type { FireFn, TrailContext, TrailExample } from '@ontrails/core';
import { z } from 'zod';

import { assertSignalAssertions, withSignalAssertions } from '../signals.js';
import type { RecordedSignal } from '../signals.js';

const userUpdated = signal('user.updated', {
  payload: z.object({
    id: z.string(),
    name: z.string(),
    revision: z.number(),
  }),
});

const signalExample = (
  overrides: Partial<TrailExample<unknown, unknown>> = {}
): TrailExample<unknown, unknown> => ({
  input: {},
  name: 'Signal example',
  ...overrides,
});

const baseCtx = (): TrailContext =>
  ({
    abortSignal: AbortSignal.timeout(5000),
    cwd: '/tmp',
    env: {},
    requestId: 'signals-test',
    trace: async (_label, fn) => await fn(),
    workspaceRoot: '/tmp',
  }) as TrailContext;

describe('signal example assertions', () => {
  test('matches expected signals without depending on fire order', () => {
    const observed: RecordedSignal[] = [
      {
        payload: { id: 'audit-1', message: 'updated' },
        signalId: 'audit.logged',
      },
      {
        payload: { id: 'u1', name: 'Ada', revision: 2 },
        signalId: userUpdated.id,
      },
    ];

    assertSignalAssertions(
      signalExample({
        signals: [
          { payloadMatch: { id: 'u1' }, signal: userUpdated },
          {
            payload: { id: 'audit-1', message: 'updated' },
            signal: 'audit.logged',
          },
        ],
      }),
      observed
    );
  });

  test('supports repeated signal assertions with times', () => {
    const observed: RecordedSignal[] = [
      { payload: { id: 'u1', revision: 1 }, signalId: userUpdated.id },
      { payload: { id: 'u1', revision: 2 }, signalId: userUpdated.id },
    ];

    assertSignalAssertions(
      signalExample({
        signals: [
          { payloadMatch: { id: 'u1' }, signal: userUpdated, times: 2 },
        ],
      }),
      observed
    );
  });

  test('reports readable failures for missing signal expectations', () => {
    const observed: RecordedSignal[] = [
      { payload: { id: 'u1', revision: 1 }, signalId: userUpdated.id },
    ];

    let message = '';
    try {
      assertSignalAssertions(
        signalExample({
          name: 'Missing audit signal',
          signals: [
            {
              payloadMatch: { id: 'audit-1' },
              signal: 'audit.logged',
            },
          ],
        }),
        observed
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain(
      'Example "Missing audit signal" expected signal signal=audit.logged payloadMatchSummary={redacted=true shape=object digest='
    );
    expect(message).toContain('topLevelEntryCount=2');
    expect(message).not.toContain('audit-1');
    expect(message).not.toContain('"u1"');
    expect(message).not.toContain('revision');
  });

  test('records ctx.fire calls while preserving an injected base fire', async () => {
    const delegated: RecordedSignal[] = [];
    const fire = (async (
      signalRef: typeof userUpdated,
      payload: unknown
    ): Promise<void> => {
      delegated.push({ payload, signalId: signalRef.id });
    }) as FireFn;

    const harness = withSignalAssertions(
      { ...baseCtx(), fire },
      signalExample({
        signals: [
          {
            payloadMatch: { id: 'u1', revision: 3 },
            signal: userUpdated,
          },
        ],
      })
    );

    await harness.ctx.fire?.(userUpdated, {
      id: 'u1',
      name: 'Ada',
      revision: 3,
    });

    expect(delegated).toEqual([
      {
        payload: { id: 'u1', name: 'Ada', revision: 3 },
        signalId: userUpdated.id,
      },
    ]);
    harness.assert();
  });
});
