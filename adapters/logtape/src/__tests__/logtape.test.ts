import { afterEach, describe, expect, test } from 'bun:test';
import { configureSync, getLogger, resetSync } from '@logtape/logtape';
import type { LogRecord as LogtapeRecord } from '@logtape/logtape';

import type { LogRecord } from '@ontrails/observability';

import { createLogtapeSink } from '../index.js';

const createRecord = (overrides: Partial<LogRecord> = {}): LogRecord => ({
  category: 'app.http',
  level: 'info',
  message: 'request received',
  metadata: { path: '/greet' },
  timestamp: new Date('2026-07-13T00:00:00.000Z'),
  ...overrides,
});

const configureRecordingSink = (): LogtapeRecord[] => {
  const records: LogtapeRecord[] = [];
  configureSync({
    loggers: [
      { category: 'app', lowestLevel: 'trace', sinks: ['record'] },
      { category: 'logtape', lowestLevel: 'fatal', sinks: [] },
    ],
    sinks: { record: (record) => records.push(record) },
  });
  return records;
};

afterEach(() => {
  resetSync();
});

describe('@ontrails/logtape', () => {
  test.each([
    ['trace', 'trace'],
    ['debug', 'debug'],
    ['info', 'info'],
    ['warn', 'warning'],
    ['error', 'error'],
    ['fatal', 'fatal'],
  ] as const)('forwards %s through LogTape emit()', (level, logtapeLevel) => {
    const records = configureRecordingSink();
    const sink = createLogtapeSink();

    sink.write(createRecord({ level }));

    expect(records).toEqual([
      expect.objectContaining({
        category: ['app', 'http'],
        level: logtapeLevel,
        properties: {
          category: 'app.http',
          path: '/greet',
          timestamp: '2026-07-13T00:00:00.000Z',
        },
        rawMessage: 'request received',
        timestamp: new Date('2026-07-13T00:00:00.000Z').getTime(),
      }),
    ]);
  });

  test('accepts an existing configured LogTape logger', () => {
    const records = configureRecordingSink();
    const sink = createLogtapeSink({ logger: getLogger('app') });

    sink.write(createRecord());

    expect(records[0]).toMatchObject({
      category: ['app'],
      properties: { category: 'app.http', path: '/greet' },
    });
  });

  test('preserves redacted metadata before delivery to LogTape', () => {
    const records = configureRecordingSink();
    const sink = createLogtapeSink();

    sink.write(
      createRecord({
        metadata: { authorization: '[REDACTED]', user: 'matt' },
      })
    );

    expect(records[0]?.properties).toMatchObject({
      authorization: '[REDACTED]',
      user: 'matt',
    });
    expect(JSON.stringify(records)).not.toContain('secret');
  });

  test('drops silent records without writing to LogTape', () => {
    const records = configureRecordingSink();
    const sink = createLogtapeSink();

    sink.write(createRecord({ level: 'silent' }));

    expect(records).toEqual([]);
  });
});
