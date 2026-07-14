import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';

import type { LogRecord } from '@ontrails/observability';

import { createPinoSink } from '../index.js';

const createRecord = (overrides: Partial<LogRecord> = {}): LogRecord => ({
  category: 'app.http',
  level: 'info',
  message: 'request received',
  metadata: { path: '/greet' },
  timestamp: new Date('2026-07-13T00:00:00.000Z'),
  ...overrides,
});

const createRecordingDestination = () => {
  const lines: string[] = [];
  /* oxlint-disable eslint-plugin-promise/prefer-await-to-callbacks -- Node Writable requires its callback-based write hook. */
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  /* oxlint-enable eslint-plugin-promise/prefer-await-to-callbacks */
  return { destination, lines };
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('@ontrails/pino', () => {
  test.each([
    ['trace', 10],
    ['debug', 20],
    ['info', 30],
    ['warn', 40],
    ['error', 50],
    ['fatal', 60],
  ] as const)(
    'forwards %s with Pino metadata and level',
    (level, pinoLevel) => {
      const { destination, lines } = createRecordingDestination();
      const logger = pino({ base: undefined, level: 'trace' }, destination);
      const sink = createPinoSink({ logger });

      sink.write(createRecord({ level }));

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        category: 'app.http',
        level: pinoLevel,
        msg: 'request received',
        path: '/greet',
        timestamp: '2026-07-13T00:00:00.000Z',
      });
    }
  );

  test('constructs a real configured Pino logger when one is not supplied', () => {
    const { destination, lines } = createRecordingDestination();
    const sink = createPinoSink({
      destination,
      pinoOptions: { base: undefined, level: 'info' },
    });

    sink.write(createRecord());

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      category: 'app.http',
      msg: 'request received',
      path: '/greet',
    });
  });

  test('preserves redacted metadata before delivery to Pino', () => {
    const { destination, lines } = createRecordingDestination();
    const sink = createPinoSink({
      logger: pino({ base: undefined, level: 'trace' }, destination),
    });

    sink.write(
      createRecord({
        metadata: { authorization: '[REDACTED]', user: 'matt' },
      })
    );

    expect(lines[0]).toContain('[REDACTED]');
    expect(lines[0]).not.toContain('secret');
  });

  test('drops silent records without writing to Pino', () => {
    const { destination, lines } = createRecordingDestination();
    const sink = createPinoSink({
      logger: pino({ base: undefined, level: 'trace' }, destination),
    });

    sink.write(createRecord({ level: 'silent' }));

    expect(lines).toEqual([]);
  });

  test('flushes an asynchronous Pino destination before resolving', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'trails-pino-flush-'));
    temporaryDirectories.push(directory);
    const destination = pino.destination({
      dest: join(directory, 'pino.ndjson'),
      sync: false,
    });
    await once(destination, 'ready');
    const sink = createPinoSink({
      logger: pino({ base: undefined, level: 'trace' }, destination),
    });

    sink.write(createRecord());
    await sink.flush();

    expect(await Bun.file(join(directory, 'pino.ndjson')).text()).toContain(
      'request received'
    );
    destination.end();
  });
});
