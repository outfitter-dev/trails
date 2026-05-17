import { describe, expect, test } from 'bun:test';

import { createPinoSink, pinoPackageName } from '../index.js';
import type { PinoLoggerLike } from '../index.js';
import type { LogRecord } from '@ontrails/observe';

interface PinoCall {
  readonly level: string;
  readonly message?: string | undefined;
  readonly payload: Record<string, unknown>;
}

const createRecordingLogger = () => {
  const calls: PinoCall[] = [];

  const logger: PinoLoggerLike = {
    debug(payload, message) {
      calls.push({ level: 'debug', message, payload });
    },
    error(payload, message) {
      calls.push({ level: 'error', message, payload });
    },
    fatal(payload, message) {
      calls.push({ level: 'fatal', message, payload });
    },
    info(payload, message) {
      calls.push({ level: 'info', message, payload });
    },
    trace(payload, message) {
      calls.push({ level: 'trace', message, payload });
    },
    warn(payload, message) {
      calls.push({ level: 'warn', message, payload });
    },
  };

  return { calls, logger };
};

const createRecord = (overrides: Partial<LogRecord> = {}): LogRecord => ({
  category: 'app.http',
  level: 'info',
  message: 'request received',
  metadata: { path: '/greet' },
  timestamp: new Date('2026-05-16T00:00:00.000Z'),
  ...overrides,
});

describe('@ontrails/pino', () => {
  test('exports the package identifier', () => {
    expect(pinoPackageName).toBe('@ontrails/pino');
  });

  test.each([
    ['trace'],
    ['debug'],
    ['info'],
    ['warn'],
    ['error'],
    ['fatal'],
  ] as const)('forwards %s records to the matching pino method', (level) => {
    const { calls, logger } = createRecordingLogger();
    const sink = createPinoSink(logger);

    sink.write(createRecord({ level }));

    expect(calls).toEqual([
      {
        level,
        message: 'request received',
        payload: {
          category: 'app.http',
          path: '/greet',
          timestamp: '2026-05-16T00:00:00.000Z',
        },
      },
    ]);
  });

  test('forwards message and metadata in the pino object-first shape', () => {
    const { calls, logger } = createRecordingLogger();
    const sink = createPinoSink(logger, { name: 'pino-test' });

    sink.write(
      createRecord({
        metadata: {
          requestId: 'req-1',
          status: 200,
        },
      })
    );

    expect(sink.name).toBe('pino-test');
    expect(calls).toEqual([
      {
        level: 'info',
        message: 'request received',
        payload: {
          category: 'app.http',
          requestId: 'req-1',
          status: 200,
          timestamp: '2026-05-16T00:00:00.000Z',
        },
      },
    ]);
  });

  test('keeps stable record fields when metadata uses the same keys', () => {
    const { calls, logger } = createRecordingLogger();
    const sink = createPinoSink(logger);

    sink.write(
      createRecord({
        metadata: {
          category: 'metadata.category',
          timestamp: 'metadata-timestamp',
        },
      })
    );

    expect(calls[0]?.payload).toMatchObject({
      category: 'app.http',
      timestamp: '2026-05-16T00:00:00.000Z',
    });
  });

  test('preserves redacted metadata without reconstructing hidden values', () => {
    const { calls, logger } = createRecordingLogger();
    const sink = createPinoSink(logger);

    sink.write(
      createRecord({
        metadata: {
          authorization: '[REDACTED]',
          user: 'matt',
        },
      })
    );

    expect(calls[0]?.payload).toMatchObject({
      authorization: '[REDACTED]',
      user: 'matt',
    });
    expect(JSON.stringify(calls)).not.toContain('secret');
  });

  test('drops silent records without calling the logger', () => {
    const { calls, logger } = createRecordingLogger();
    const sink = createPinoSink(logger);

    sink.write(createRecord({ level: 'silent' }));

    expect(calls).toEqual([]);
  });

  test('fails loudly when the structural logger is missing a required method', () => {
    const { logger } = createRecordingLogger();
    const malformedLogger = {
      ...logger,
      warn: undefined,
    } as unknown as PinoLoggerLike;

    expect(() => createPinoSink(malformedLogger)).toThrow(
      'Pino logger is missing "warn" method'
    );
  });
});
