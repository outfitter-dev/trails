import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { closeSync as closeSyncImport } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createConsoleSink,
  createFileSink,
  createJsonFormatter,
  createMemorySink,
  createPrettyFormatter,
} from '../index.js';
import type {
  LogFormatter,
  LogLevel,
  LogRecord,
  TraceRecord,
} from '../index.js';

const tempDirs: string[] = [];

const createLogRecord = (overrides?: Partial<LogRecord>): LogRecord => ({
  category: 'observe.test',
  level: 'info',
  message: 'test message',
  metadata: {},
  timestamp: new Date('2026-04-24T12:00:00.000Z'),
  ...overrides,
});

const createTraceRecord = (id: string): TraceRecord => ({
  attrs: {},
  endedAt: 2,
  id,
  kind: 'trail',
  name: `trail.${id}`,
  rootId: 'root-1',
  startedAt: 1,
  status: 'ok',
  traceId: 'trace-1',
  trailId: `trail.${id}`,
});

const createTempLogPath = async (): Promise<{
  readonly dir: string;
  readonly path: string;
}> => {
  const dir = await mkdtemp(join(tmpdir(), 'observe-sink-'));
  tempDirs.push(dir);
  return { dir, path: join(dir, 'observe.log') };
};

const readLines = async (path: string): Promise<string[]> => {
  const content = await Bun.file(path).text();
  return content.trimEnd().split('\n');
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe('createConsoleSink', () => {
  const originalDebug = console.debug;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    // oxlint-disable-next-line no-empty-function
    console.debug = mock(() => {});
    // oxlint-disable-next-line no-empty-function
    console.info = mock(() => {});
    // oxlint-disable-next-line no-empty-function
    console.warn = mock(() => {});
    // oxlint-disable-next-line no-empty-function
    console.error = mock(() => {});
  });

  afterEach(() => {
    console.debug = originalDebug;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  });

  test.each([
    ['trace', 'debug'],
    ['debug', 'debug'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
    ['fatal', 'error'],
  ] as const)(
    'routes %s records to console.%s',
    (level: LogLevel, method: 'debug' | 'error' | 'info' | 'warn') => {
      const sink = createConsoleSink({
        formatter: { format: (record) => `formatted:${record.level}` },
      });

      sink.write(createLogRecord({ level }));

      expect(console[method]).toHaveBeenCalledWith(`formatted:${level}`);
    }
  );

  test('drops silent records even when stderr routing is enabled', () => {
    const formatter: LogFormatter = {
      format: () => 'should not be emitted',
    };
    const sink = createConsoleSink({ formatter, stderr: true });

    sink.write(createLogRecord({ level: 'silent' }));

    expect(console.error).not.toHaveBeenCalled();
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('routes every non-silent record to console.error when stderr is enabled', () => {
    const sink = createConsoleSink({
      formatter: { format: (record) => `formatted:${record.level}` },
      stderr: true,
    });

    sink.write(createLogRecord({ level: 'info' }));
    sink.write(createLogRecord({ level: 'debug' }));

    expect(console.error).toHaveBeenCalledWith('formatted:info');
    expect(console.error).toHaveBeenCalledWith('formatted:debug');
    expect(console.info).not.toHaveBeenCalled();
    expect(console.debug).not.toHaveBeenCalled();
  });

  test('passes the LogRecord to the configured formatter', () => {
    const formatter: LogFormatter = {
      format: (record) => {
        expect(record.category).toBe('observe.formatter');
        expect(record.message).toBe('custom message');
        expect(record.metadata).toEqual({ requestId: 'req-1' });
        return 'custom output';
      },
    };
    const sink = createConsoleSink({ formatter });

    sink.write(
      createLogRecord({
        category: 'observe.formatter',
        message: 'custom message',
        metadata: { requestId: 'req-1' },
      })
    );

    expect(console.info).toHaveBeenCalledWith('custom output');
  });
});

describe('createJsonFormatter', () => {
  test('preserves structured log fields when metadata uses the same keys', () => {
    const formatter = createJsonFormatter();
    const formatted = JSON.parse(
      formatter.format(
        createLogRecord({
          category: 'observe.structured',
          level: 'warn',
          message: 'structured message',
          metadata: {
            category: 'metadata.category',
            extra: 'kept',
            level: 'debug',
            message: 'metadata message',
            timestamp: 'not-a-date',
          },
        })
      )
    );

    expect(formatted).toEqual({
      category: 'observe.structured',
      extra: 'kept',
      level: 'warn',
      message: 'structured message',
      timestamp: '2026-04-24T12:00:00.000Z',
    });
  });

  test('serializes BigInt metadata values as decimal strings', () => {
    const formatter = createJsonFormatter();
    const formatted = JSON.parse(
      formatter.format(
        createLogRecord({
          metadata: { userId: 9_007_199_254_740_993n },
        })
      )
    );

    expect(formatted.userId).toBe('9007199254740993');
  });

  test('replaces circular references without throwing', () => {
    const formatter = createJsonFormatter();
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;

    let output = '';
    expect(() => {
      output = formatter.format(
        createLogRecord({
          metadata: { cyclic },
        })
      );
    }).not.toThrow();

    const parsed = JSON.parse(output);
    expect(parsed.cyclic).toMatchObject({ name: 'root', self: '[Circular]' });
  });

  test('sanitizes functions and symbols in metadata', () => {
    const formatter = createJsonFormatter();
    const parsed = JSON.parse(
      formatter.format(
        createLogRecord({
          metadata: {
            handler: () => 'noop',
            tag: Symbol('observe.tag'),
          },
        })
      )
    );

    expect(parsed.handler).toBe('[Function]');
    expect(parsed.tag).toBe('Symbol(observe.tag)');
  });

  test('does not leak the circular tracker between successive records', () => {
    const formatter = createJsonFormatter();
    const shared = { id: 'shared' };

    const first = JSON.parse(
      formatter.format(createLogRecord({ metadata: { ref: shared } }))
    );
    const second = JSON.parse(
      formatter.format(createLogRecord({ metadata: { ref: shared } }))
    );

    expect(first.ref).toEqual({ id: 'shared' });
    expect(second.ref).toEqual({ id: 'shared' });
  });

  test('serializes shared sibling references without marking them circular', () => {
    const formatter = createJsonFormatter();
    const shared = { value: 42 };
    const parsed = JSON.parse(
      formatter.format(
        createLogRecord({
          metadata: {
            payload: {
              a: { config: shared },
              b: { config: shared },
              list: [shared, shared],
            },
          },
        })
      )
    );

    expect(parsed.payload).toEqual({
      a: { config: { value: 42 } },
      b: { config: { value: 42 } },
      list: [{ value: 42 }, { value: 42 }],
    });
  });

  test('marks only ancestor cycles as circular when sibling repetition is present', () => {
    const formatter = createJsonFormatter();
    const shared = { tag: 'shared' };
    const cyclic: Record<string, unknown> = { name: 'root', shared };
    cyclic['self'] = cyclic;

    const parsed = JSON.parse(
      formatter.format(
        createLogRecord({
          metadata: {
            cyclic,
            mirror: shared,
          },
        })
      )
    );

    expect(parsed.cyclic).toMatchObject({
      name: 'root',
      self: '[Circular]',
      shared: { tag: 'shared' },
    });
    expect(parsed.mirror).toEqual({ tag: 'shared' });
  });
});

describe('createPrettyFormatter', () => {
  test('formats records without metadata using level, category, and message', () => {
    const formatter = createPrettyFormatter({ timestamps: false });

    expect(
      formatter.format(
        createLogRecord({
          category: 'observe.pretty',
          level: 'info',
          message: 'hello',
        })
      )
    ).toBe('INFO  [observe.pretty] hello');
  });

  test('serializes BigInt metadata values as decimal strings', () => {
    const formatter = createPrettyFormatter({ timestamps: false });

    const output = formatter.format(
      createLogRecord({
        metadata: { userId: 9_007_199_254_740_993n },
      })
    );

    expect(output).toContain('userId="9007199254740993"');
  });

  test('replaces circular references without throwing', () => {
    const formatter = createPrettyFormatter({ timestamps: false });
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;

    let output = '';
    expect(() => {
      output = formatter.format(
        createLogRecord({
          metadata: { cyclic },
        })
      );
    }).not.toThrow();

    expect(output).toContain('"[Circular]"');
    expect(output).toContain('"name":"root"');
  });

  test('sanitizes functions and symbols in metadata', () => {
    const formatter = createPrettyFormatter({ timestamps: false });

    const output = formatter.format(
      createLogRecord({
        metadata: {
          handler: () => 'noop',
          tag: Symbol('observe.tag'),
        },
      })
    );

    expect(output).toContain('handler="[Function]"');
    expect(output).toContain('tag="Symbol(observe.tag)"');
  });

  test('does not leak the circular tracker between successive records', () => {
    const formatter = createPrettyFormatter({ timestamps: false });
    const shared = { id: 'shared' };

    const first = formatter.format(
      createLogRecord({ metadata: { ref: shared } })
    );
    const second = formatter.format(
      createLogRecord({ metadata: { ref: shared } })
    );

    expect(first).toContain('"id":"shared"');
    expect(first).not.toContain('[Circular]');
    expect(second).toContain('"id":"shared"');
    expect(second).not.toContain('[Circular]');
  });

  test('serializes shared sibling references without marking them circular', () => {
    const formatter = createPrettyFormatter({ timestamps: false });
    const shared = { value: 42 };

    const output = formatter.format(
      createLogRecord({
        metadata: {
          payload: {
            a: { config: shared },
            b: { config: shared },
          },
        },
      })
    );

    expect(output).not.toContain('[Circular]');
    expect(output).toContain('"a":{"config":{"value":42}}');
    expect(output).toContain('"b":{"config":{"value":42}}');
  });

  test('does not leak path state across metadata entries that share a reference', () => {
    const formatter = createPrettyFormatter({ timestamps: false });
    const shared = { tag: 'shared' };

    const output = formatter.format(
      createLogRecord({
        metadata: {
          first: shared,
          second: shared,
        },
      })
    );

    expect(output).not.toContain('[Circular]');
    expect(output).toContain('first={"tag":"shared"}');
    expect(output).toContain('second={"tag":"shared"}');
  });
});

describe('createFileSink', () => {
  test('accepts a path and appends formatted records without rotating', async () => {
    const { dir, path } = await createTempLogPath();
    const sink = createFileSink(path, {
      formatter: { format: (record) => record.message },
    });

    sink.write(createLogRecord({ message: 'line 1' }));
    sink.write(createLogRecord({ message: 'line 2' }));

    expect(typeof sink.flush).toBe('function');
    await sink.flush?.();

    const entries = await readdir(dir);

    expect(await readLines(path)).toEqual(['line 1', 'line 2']);
    expect([...entries].toSorted()).toEqual(['observe.log']);
  });

  test('preserves existing records when opening an existing log file', async () => {
    const { path } = await createTempLogPath();
    await Bun.write(path, 'existing line\n');
    const sink = createFileSink(path, {
      formatter: { format: (record) => record.message },
    });

    sink.write(createLogRecord({ message: 'line after restart' }));

    await expect(sink.close()).resolves.toBeUndefined();
    expect(await readLines(path)).toEqual([
      'existing line',
      'line after restart',
    ]);
  });

  test('accepts an options object with a formatter', async () => {
    const { path } = await createTempLogPath();
    const formatter: LogFormatter = {
      format: (record) =>
        JSON.stringify({ category: record.category, level: record.level }),
    };
    const sink = createFileSink({ formatter, path });

    sink.write(createLogRecord({ category: 'observe.file', level: 'warn' }));
    await sink.flush?.();

    expect(await readLines(path)).toEqual([
      '{"category":"observe.file","level":"warn"}',
    ]);
  });

  test('creates parent directories before opening the file writer', async () => {
    const { dir } = await createTempLogPath();
    const path = join(dir, 'nested', 'observe.log');
    const sink = createFileSink(path, {
      formatter: { format: (record) => record.message },
    });

    sink.write(createLogRecord({ message: 'nested line' }));
    await sink.flush();

    expect(await readLines(path)).toEqual(['nested line']);
  });

  test('closes the file writer and rejects later writes', async () => {
    const { path } = await createTempLogPath();
    const sink = createFileSink(path, {
      formatter: { format: (record) => record.message },
    });

    sink.write(createLogRecord({ message: 'closed line' }));

    await expect(sink.close()).resolves.toBeUndefined();
    await expect(sink.close()).resolves.toBeUndefined();

    expect(await readLines(path)).toEqual(['closed line']);
    expect(() => sink.write(createLogRecord())).toThrow(
      'Cannot write to a closed file sink'
    );
  });

  test('propagates synchronous write failures from the underlying writer', async () => {
    const { path } = await createTempLogPath();

    const writeError = new Error('simulated write failure');
    const originalBunFile = Bun.file;
    const stubFile = ((descriptor: number | string | URL) => {
      const real = (originalBunFile as (arg: unknown) => unknown)(
        descriptor
      ) as { writer: () => unknown };
      return {
        ...(real as object),
        writer: () => {
          const realWriter = real.writer() as {
            write: (chunk: string) => number;
            flush: () => number | Promise<number>;
            end: (error?: Error) => number | Promise<number>;
          };
          return {
            end: realWriter.end.bind(realWriter),
            flush: realWriter.flush.bind(realWriter),
            write: () => {
              throw writeError;
            },
          };
        },
      };
    }) as unknown as typeof Bun.file;

    (Bun as { file: typeof Bun.file }).file = stubFile;
    try {
      const sink = createFileSink(path, {
        formatter: { format: (record) => record.message },
      });
      expect(() => sink.write(createLogRecord({ message: 'oops' }))).toThrow(
        'simulated write failure'
      );
      // Close should still succeed even after a failed write.
      await sink.close();
    } finally {
      (Bun as { file: typeof Bun.file }).file = originalBunFile;
    }
  });

  test('preserves the writer.end() error when closeSync also fails', async () => {
    const { path } = await createTempLogPath();

    const endError = new Error('writer end exploded');

    const originalBunFile = Bun.file;
    let capturedFd: number | undefined;
    const stubFile = ((descriptor: number | string | URL) => {
      if (typeof descriptor === 'number') {
        capturedFd = descriptor;
      }
      const real = (originalBunFile as (arg: unknown) => unknown)(
        descriptor
      ) as { writer: () => unknown };
      return {
        ...(real as object),
        writer: () => {
          const realWriter = real.writer() as {
            write: (chunk: string) => number;
            flush: () => number | Promise<number>;
            end: (error?: Error) => number | Promise<number>;
          };
          return {
            end: () => {
              throw endError;
            },
            flush: realWriter.flush.bind(realWriter),
            write: realWriter.write.bind(realWriter),
          };
        },
      };
    }) as unknown as typeof Bun.file;

    (Bun as { file: typeof Bun.file }).file = stubFile;
    try {
      const sink = createFileSink(path, {
        formatter: { format: (record) => record.message },
      });
      // Close the fd out-of-band so sink.close()'s internal closeSync(fd)
      // also fails (EBADF). Both errors fire; the writer.end() error must win.
      expect(capturedFd).toBeDefined();
      if (capturedFd !== undefined) {
        closeSyncImport(capturedFd);
      }
      await expect(sink.close()).rejects.toBe(endError);
    } finally {
      (Bun as { file: typeof Bun.file }).file = originalBunFile;
    }
  });

  test('writer.end() error wins when closeSync succeeds', async () => {
    const { path } = await createTempLogPath();

    const endError = new Error('only writer end fails');
    const originalBunFile = Bun.file;
    const stubFile = ((descriptor: number | string | URL) => {
      const real = (originalBunFile as (arg: unknown) => unknown)(
        descriptor
      ) as { writer: () => unknown };
      return {
        ...(real as object),
        writer: () => {
          const realWriter = real.writer() as {
            write: (chunk: string) => number;
            flush: () => number | Promise<number>;
            end: (error?: Error) => number | Promise<number>;
          };
          return {
            end: () => {
              throw endError;
            },
            flush: realWriter.flush.bind(realWriter),
            write: realWriter.write.bind(realWriter),
          };
        },
      };
    }) as unknown as typeof Bun.file;

    (Bun as { file: typeof Bun.file }).file = stubFile;
    try {
      const sink = createFileSink(path, {
        formatter: { format: (record) => record.message },
      });
      await expect(sink.close()).rejects.toBe(endError);
    } finally {
      (Bun as { file: typeof Bun.file }).file = originalBunFile;
    }
  });
});

describe('createMemorySink', () => {
  test('retains trace records up to the configured cap', async () => {
    const sink = createMemorySink({ maxRecords: 2 });

    await sink.write(createTraceRecord('a'));
    await sink.write(createTraceRecord('b'));
    await sink.write(createTraceRecord('c'));

    expect(sink.records().map((record) => record.id)).toEqual(['b', 'c']);
  });

  test('records returns a stable snapshot and clear removes retained records', async () => {
    const sink = createMemorySink({ maxRecords: 3 });

    await sink.write(createTraceRecord('a'));
    const snapshot = sink.records();
    await sink.write(createTraceRecord('b'));

    expect(snapshot.map((record) => record.id)).toEqual(['a']);
    expect(sink.records().map((record) => record.id)).toEqual(['a', 'b']);

    sink.clear();

    expect(sink.records()).toEqual([]);
  });
});
