import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  SIGNAL_DIAGNOSTICS_SINK_KEY,
  SIGNAL_DIAGNOSTICS_STRICT_MODE_KEY,
  createSignalHandlerFailedDiagnostic,
  createSignalInvalidDiagnostic,
  recordSignalDiagnostic,
  schemaIssuesFromZod,
  shouldPromoteSignalDiagnostic,
  signalDiagnosticDefinitions,
  summarizeSignalPayload,
} from '../signal-diagnostics';
import type {
  SignalDiagnostic,
  SignalDiagnosticSink,
} from '../signal-diagnostics';

const invalidPayloadIssues = () => {
  const parsed = z.object({ orderId: z.string() }).safeParse({ orderId: 42 });
  if (parsed.success) {
    throw new Error('Expected invalid fixture payload');
  }
  return parsed.error.issues;
};

const invalidDiagnostic = (): SignalDiagnostic =>
  createSignalInvalidDiagnostic({
    payload: { orderId: 42, secret: 'do-not-log' },
    producerTrailId: 'order.create',
    schemaIssues: invalidPayloadIssues(),
    signalId: 'order.placed',
    traceId: 'trace-1',
  });

describe('signal diagnostics', () => {
  test('defines diagnostics from an owner-shaped record, not a parallel code list', () => {
    expect(signalDiagnosticDefinitions['signal.invalid']).toEqual({
      category: 'validation',
      description:
        'A signal payload failed schema validation at the fire boundary.',
      level: 'error',
    });
    expect(Object.keys(signalDiagnosticDefinitions).toSorted()).toEqual([
      'signal.fire.suppressed',
      'signal.handler.failed',
      'signal.handler.rejected',
      'signal.invalid',
      'signal.unknown',
    ]);
  });

  test('summarizes payloads without exposing raw values', () => {
    const left = summarizeSignalPayload({
      amount: 12,
      orderId: 'ord_secret',
    });
    const right = summarizeSignalPayload(
      Object.fromEntries([
        ['orderId', 'ord_secret'],
        ['amount', 12],
      ])
    );

    expect(left).toEqual(right);
    expect(left.digest).toBe(
      '6a64d6766d619deb34076e2e31375980ce5c0e5574d55128d2f196dafa110294'
    );
    expect(left.redacted).toBe(true);
    expect(left.shape).toBe('object');
    expect(left.topLevelEntryCount).toBe(2);
    expect(JSON.stringify(left)).not.toContain('ord_secret');
  });

  test('summarizes non-json payloads without throwing', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const throwingGetter = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        throw new Error('getter exploded');
      },
    });

    expect(summarizeSignalPayload(1n).shape).toBe('bigint');
    expect(summarizeSignalPayload(circular).shape).toBe('object');
    expect(summarizeSignalPayload(() => {}).shape).toBe('function');
    expect(() =>
      summarizeSignalPayload({ createdAt: new Date('not-a-date') })
    ).not.toThrow();
    expect(() => summarizeSignalPayload(throwingGetter)).not.toThrow();
    expect(summarizeSignalPayload(throwingGetter)).toMatchObject({
      redacted: true,
      shape: 'object',
      topLevelEntryCount: 1,
    });
  });

  test('summarizes revoked proxies without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({ secret: 'do-not-log' }, {});
    revoke();

    expect(() => summarizeSignalPayload(proxy)).not.toThrow();
    expect(summarizeSignalPayload(proxy)).toMatchObject({
      redacted: true,
      shape: 'object',
      topLevelEntryCount: undefined,
    });
  });

  test('maps zod issues into diagnostic schema issue records', () => {
    expect(schemaIssuesFromZod(invalidPayloadIssues())).toEqual([
      {
        code: 'invalid_type',
        message: expect.any(String),
        path: ['orderId'],
      },
    ]);
  });

  test('builds invalid-payload diagnostics with redacted payload summaries', () => {
    const diagnostic = invalidDiagnostic();

    expect(diagnostic).toMatchObject({
      category: 'validation',
      code: 'signal.invalid',
      level: 'error',
      origin: 'fire-boundary',
      producerTrailId: 'order.create',
      signalId: 'order.placed',
      traceId: 'trace-1',
    });
    expect(diagnostic.schemaIssues[0]?.path).toEqual(['orderId']);
    expect(JSON.stringify(diagnostic.payload)).not.toContain('do-not-log');
  });

  test('builds handler diagnostics with normalized causes', () => {
    const diagnostic = createSignalHandlerFailedDiagnostic({
      cause: new TypeError('handler broke'),
      handlerTrailId: 'notify.email',
      payload: { orderId: 'ord_secret' },
      signalId: 'order.placed',
    });

    expect(diagnostic).toMatchObject({
      category: 'handler',
      cause: {
        message: 'handler broke',
        name: 'TypeError',
      },
      code: 'signal.handler.failed',
      handlerTrailId: 'notify.email',
      level: 'error',
      origin: 'handler',
      signalId: 'order.placed',
    });
    expect(JSON.stringify(diagnostic.payload)).not.toContain('ord_secret');
  });

  test('promotes diagnostics according to strict mode', () => {
    const diagnostic = invalidDiagnostic();

    expect(shouldPromoteSignalDiagnostic(diagnostic)).toBe(false);
    expect(shouldPromoteSignalDiagnostic(diagnostic, 'off')).toBe(false);
    expect(shouldPromoteSignalDiagnostic(diagnostic, true)).toBe(true);
    expect(shouldPromoteSignalDiagnostic(diagnostic, 'all')).toBe(true);
    expect(shouldPromoteSignalDiagnostic(diagnostic, 'error')).toBe(true);
    expect(
      shouldPromoteSignalDiagnostic(diagnostic, ['signal.handler.failed'])
    ).toBe(false);
    expect(shouldPromoteSignalDiagnostic(diagnostic, ['signal.invalid'])).toBe(
      true
    );
    expect(
      shouldPromoteSignalDiagnostic(
        diagnostic,
        (candidate) => candidate.signalId === 'order.placed'
      )
    ).toBe(true);
    expect(
      shouldPromoteSignalDiagnostic(diagnostic, () => {
        throw new Error('strict predicate failure');
      })
    ).toBe(false);
  });

  test('records diagnostics through the configured side-channel sink', async () => {
    const diagnostics: SignalDiagnostic[] = [];
    const sink: SignalDiagnosticSink = (diagnostic) => {
      diagnostics.push(diagnostic);
    };
    const diagnostic = invalidDiagnostic();
    const result = await recordSignalDiagnostic(
      {
        extensions: {
          [SIGNAL_DIAGNOSTICS_SINK_KEY]: sink,
          [SIGNAL_DIAGNOSTICS_STRICT_MODE_KEY]: ['signal.invalid'],
        },
      },
      diagnostic
    );

    expect(result).toEqual({
      delivered: true,
      diagnostic,
      promoted: true,
    });
    expect(diagnostics).toEqual([diagnostic]);
  });

  test('keeps diagnostic sink failures out of producer control flow', async () => {
    const warnings: Record<string, unknown>[] = [];
    const diagnostic = invalidDiagnostic();
    const result = await recordSignalDiagnostic(
      {
        extensions: {
          [SIGNAL_DIAGNOSTICS_SINK_KEY]: () => {
            throw new Error('sink offline');
          },
          [SIGNAL_DIAGNOSTICS_STRICT_MODE_KEY]: 'error',
        },
        logger: {
          warn(_message, data) {
            warnings.push(data ?? {});
          },
        },
      },
      diagnostic
    );

    expect(result).toMatchObject({
      delivered: false,
      diagnostic,
      promoted: true,
      sinkError: {
        message: 'sink offline',
        name: 'Error',
      },
    });
    expect(warnings).toEqual([
      {
        code: 'signal.invalid',
        error: 'sink offline',
        signalId: 'order.placed',
      },
    ]);
  });
});
