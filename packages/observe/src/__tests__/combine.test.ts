import { ValidationError } from '@ontrails/core';
import { describe, expect, test } from 'bun:test';
import { combine } from '../combine.js';
import type { LogRecord, LogSink, TraceRecord, TraceSink } from '../index.js';

const createLogRecord = (message = 'hello'): LogRecord => ({
  category: 'observe.test',
  level: 'info',
  message,
  metadata: {},
  timestamp: new Date(0),
});

const createTraceRecord = (name = 'observe.trace'): TraceRecord => ({
  attrs: {},
  id: `${name}.id`,
  kind: 'span',
  name,
  rootId: 'root-1',
  startedAt: 1,
  status: 'ok',
  traceId: 'trace-1',
});

describe('combine', () => {
  describe('empty sink rejection', () => {
    test('throws ValidationError when called with zero sinks', () => {
      expect(() => combine()).toThrow(ValidationError);
      expect(() => combine()).toThrow(/at least one sink/i);
    });

    test('throws ValidationError when called with an empty array spread', () => {
      const sinks: readonly LogSink[] = [];
      expect(() => combine(...sinks)).toThrow(ValidationError);
    });

    test('accepts a single sink', () => {
      const records: LogRecord[] = [];
      const only: LogSink = {
        name: 'only',
        write: (record) => {
          records.push(record);
        },
      };

      expect(() => combine(only)).not.toThrow();

      const sink = combine(only);
      const record = createLogRecord('single');
      sink.write(record);

      expect(records).toEqual([record]);
      expect(sink.observes).toEqual({ log: true });
    });
  });

  test('fans out log records to every child sink', () => {
    const firstRecords: LogRecord[] = [];
    const secondRecords: LogRecord[] = [];
    const first: LogSink = {
      name: 'first',
      write: (record) => {
        firstRecords.push(record);
      },
    };
    const second: LogSink = {
      name: 'second',
      write: (record) => {
        secondRecords.push(record);
      },
    };
    const sink = combine(first, second);
    const record = createLogRecord();

    sink.write(record);

    expect(firstRecords).toEqual([record]);
    expect(secondRecords).toEqual([record]);
  });

  test('fans out trace records to async child sinks', async () => {
    const firstRecords: TraceRecord[] = [];
    const secondRecords: TraceRecord[] = [];
    const first: TraceSink = {
      write: (record) => {
        firstRecords.push(record);
      },
    };
    const second: TraceSink = {
      write: async (record) => {
        secondRecords.push(record);
      },
    };
    const sink = combine(first, second);
    const record = createTraceRecord();

    await sink.write(record);

    expect(firstRecords).toEqual([record]);
    expect(secondRecords).toEqual([record]);
  });

  test('exposes combined log and trace capabilities', () => {
    const log: LogSink = { name: 'log', write: () => {} };
    const trace: TraceSink = { write: () => {} };
    const sink = combine(log, trace);

    expect(sink.observes).toEqual({ log: true, trace: true });
  });

  test('routes mixed records only to compatible child sinks', async () => {
    const logRecords: LogRecord[] = [];
    const traceRecords: TraceRecord[] = [];
    const log: LogSink = {
      name: 'log',
      write: (record) => {
        logRecords.push(record);
      },
    };
    const trace: TraceSink = {
      write: (record) => {
        traceRecords.push(record);
      },
    };
    const sink = combine(log, trace);
    const logRecord = createLogRecord('routed log');
    const traceRecord = createTraceRecord('observe.routed');

    sink.write(logRecord);
    await sink.write(traceRecord);

    expect(logRecords).toEqual([logRecord]);
    expect(traceRecords).toEqual([traceRecord]);
  });

  test('honors explicit trace capabilities on named sinks', async () => {
    const traceRecords: TraceRecord[] = [];
    const namedTrace: TraceSink & {
      readonly name: string;
      readonly observes: { readonly trace: true };
    } = {
      name: 'named-trace',
      observes: { trace: true },
      write: (record) => {
        traceRecords.push(record);
      },
    };
    const sink = combine(namedTrace);
    const record = createTraceRecord('observe.named');

    await sink.write(record);

    expect(sink.observes).toEqual({ trace: true });
    expect(traceRecords).toEqual([record]);
  });

  test('isolates synchronous child sink errors and reports them to log-capable siblings', () => {
    const goodRecords: LogRecord[] = [];
    const bad: LogSink = {
      name: 'bad',
      write: () => {
        throw new Error('sink exploded');
      },
    };
    const good: LogSink = {
      name: 'good',
      write: (record) => {
        goodRecords.push(record);
      },
    };
    const sink = combine(bad, good);
    const record = createLogRecord('original');

    expect(() => sink.write(record)).not.toThrow();

    expect(goodRecords[0]).toBe(record);
    expect(goodRecords[1]).toMatchObject({
      category: 'observe.combine',
      level: 'warn',
      message: 'Observe sink write failed; continuing with remaining sinks',
      metadata: {
        error: 'sink exploded',
        recordCategory: 'observe.test',
        sinkIndex: 0,
        sinkName: 'bad',
      },
    });
  });

  test('isolates rejected async child sink writes', async () => {
    const goodRecords: TraceRecord[] = [];
    const bad: TraceSink = {
      write: async () => {
        throw new Error('async sink exploded');
      },
    };
    const good: TraceSink = {
      write: (record) => {
        goodRecords.push(record);
      },
    };
    const sink = combine(bad, good);
    const record = createTraceRecord('observe.async');

    await expect(sink.write(record)).resolves.toBeUndefined();

    expect(goodRecords).toEqual([record]);
  });

  test('reports rejected async child sink writes to log-capable siblings', async () => {
    const logRecords: LogRecord[] = [];
    const bad: TraceSink = {
      write: async () => {
        throw new Error('async sink exploded');
      },
    };
    const log: LogSink = {
      name: 'log',
      write: (record) => {
        logRecords.push(record);
      },
    };
    const sink = combine(bad, log);
    const record = createTraceRecord('observe.async.reported');

    await expect(sink.write(record)).resolves.toBeUndefined();

    expect(logRecords).toHaveLength(1);
    expect(logRecords[0]).toMatchObject({
      category: 'observe.combine',
      level: 'warn',
      message: 'Observe sink write failed; continuing with remaining sinks',
      metadata: {
        error: 'async sink exploded',
        recordId: 'observe.async.reported.id',
        sinkIndex: 0,
        traceId: 'trace-1',
      },
    });
  });

  test('flushes every flushable child and isolates flush errors', async () => {
    const flushed: string[] = [];
    const bad: LogSink = {
      flush: async () => {
        throw new Error('flush exploded');
      },
      name: 'bad',
      write: () => {},
    };
    const good: LogSink = {
      flush: async () => {
        flushed.push('good');
      },
      name: 'good',
      write: () => {},
    };
    const trace: TraceSink & { readonly flush: () => Promise<void> } = {
      flush: async () => {
        flushed.push('trace');
      },
      write: () => {},
    };
    const sink = combine(bad, good, trace);

    await expect(sink.flush()).resolves.toBeUndefined();

    expect(flushed).toEqual(['good', 'trace']);
  });

  test('flush preserves child sink method bindings', async () => {
    class ClassSink implements LogSink {
      readonly flushed: string[] = [];
      readonly name = 'class-sink';

      async flush(): Promise<void> {
        this.flushed.push(this.name);
      }

      write(): void {
        expect(this.name).toBe('class-sink');
      }
    }

    const classSink = new ClassSink();
    const sink = combine(classSink);

    await expect(sink.flush()).resolves.toBeUndefined();

    expect(classSink.flushed).toEqual(['class-sink']);
  });
});
