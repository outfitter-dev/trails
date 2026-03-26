import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { createConsoleSink, createFileSink } from '../sinks.js';
import type { LogFormatter, LogRecord } from '../types.js';

const makeRecord = (overrides?: Partial<LogRecord>): LogRecord => ({
  category: 'app.test',
  level: 'info',
  message: 'test message',
  metadata: {},
  timestamp: new Date('2026-03-25T10:00:00.000Z'),
  ...overrides,
});

const formattedSink = () =>
  createConsoleSink({
    formatter: { format: () => 'formatted' },
  });

const parseJsonLines = async (
  path: string
): Promise<Record<string, unknown>[]> => {
  const content = await Bun.file(path).text();
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

// ---------------------------------------------------------------------------
// createConsoleSink
// ---------------------------------------------------------------------------

describe('createConsoleSink', () => {
  const originalDebug = console.debug;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    // oxlint-disable-next-line no-empty-function
    console.debug = mock(() => {
      // noop
    });
    // oxlint-disable-next-line no-empty-function
    console.info = mock(() => {
      // noop
    });
    // oxlint-disable-next-line no-empty-function
    console.warn = mock(() => {
      // noop
    });
    // oxlint-disable-next-line no-empty-function
    console.error = mock(() => {
      // noop
    });
  });

  afterEach(() => {
    console.debug = originalDebug;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  });

  describe('level routing', () => {
    test('writes to console.debug for trace level', () => {
      const sink = formattedSink();
      sink.write(makeRecord({ level: 'trace' }));
      expect(console.debug).toHaveBeenCalledWith('formatted');
    });

    test('writes to console.debug for debug level', () => {
      const sink = formattedSink();
      sink.write(makeRecord({ level: 'debug' }));
      expect(console.debug).toHaveBeenCalledWith('formatted');
    });

    test('writes to console.info for info level', () => {
      const sink = formattedSink();
      sink.write(makeRecord({ level: 'info' }));
      expect(console.info).toHaveBeenCalledWith('formatted');
    });

    test('writes to console.warn for warn level', () => {
      const sink = formattedSink();
      sink.write(makeRecord({ level: 'warn' }));
      expect(console.warn).toHaveBeenCalledWith('formatted');
    });

    test('writes to console.error for error level', () => {
      const sink = formattedSink();
      sink.write(makeRecord({ level: 'error' }));
      expect(console.error).toHaveBeenCalledWith('formatted');
    });

    test('writes to console.error for fatal level', () => {
      const sink = formattedSink();
      sink.write(makeRecord({ level: 'fatal' }));
      expect(console.error).toHaveBeenCalledWith('formatted');
    });
  });

  describe('configuration', () => {
    test('uses the provided formatter', () => {
      const formatter: LogFormatter = {
        format: (record) => `custom: ${record.message}`,
      };
      const sink = createConsoleSink({ formatter });
      sink.write(makeRecord({ message: 'hello' }));
      expect(console.info).toHaveBeenCalledWith('custom: hello');
    });

    test("sink has name 'console'", () => {
      const sink = createConsoleSink();
      expect(sink.name).toBe('console');
    });
  });
});

// ---------------------------------------------------------------------------
// createFileSink
// ---------------------------------------------------------------------------

describe('createFileSink', () => {
  test('appends records to the specified file', async () => {
    const tmpPath = `/tmp/test-logging-sink-${Date.now()}.log`;
    const sink = createFileSink({ path: tmpPath });

    sink.write(makeRecord({ message: 'line 1' }));
    sink.write(makeRecord({ message: 'line 2' }));
    await sink.flush?.();

    const lines = await parseJsonLines(tmpPath);

    expect(lines).toHaveLength(2);
    expect(lines[0]?.['message']).toBe('line 1');
    expect(lines[1]?.['message']).toBe('line 2');
  });

  test('flush completes pending writes', async () => {
    const tmpPath = `/tmp/test-logging-flush-${Date.now()}.log`;
    const sink = createFileSink({ path: tmpPath });

    sink.write(makeRecord({ message: 'flushed' }));
    await sink.flush?.();

    const content = await Bun.file(tmpPath).text();
    expect(content).toContain('flushed');
  });

  test("sink has name 'file'", () => {
    const tmpPath = `/tmp/test-logging-name-${Date.now()}.log`;
    const sink = createFileSink({ path: tmpPath });
    expect(sink.name).toBe('file');
  });

  test('write receives a well-formed LogRecord', () => {
    const tmpPath = `/tmp/test-logging-record-${Date.now()}.log`;
    const formatter: LogFormatter = {
      format: (record) => {
        // Verify shape
        expect(record.level).toBe('warn');
        expect(record.message).toBe('check shape');
        expect(record.category).toBe('test.shape');
        expect(record.timestamp).toBeInstanceOf(Date);
        expect(record.metadata).toEqual({ key: 'val' });
        return 'ok';
      },
    };
    const sink = createFileSink({ formatter, path: tmpPath });
    sink.write(
      makeRecord({
        category: 'test.shape',
        level: 'warn',
        message: 'check shape',
        metadata: { key: 'val' },
      })
    );
  });
});
