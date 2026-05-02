import { describe, expect, test } from 'bun:test';
import type {
  Logger,
  LogFormatter,
  LogLevel,
  LogRecord,
  LogSink,
  ObserveCapabilities,
  TraceContext,
  TraceRecord,
  TraceSink,
} from '@ontrails/observe';

const createLogRecord = (level: LogLevel): LogRecord => ({
  category: 'observe.test',
  level,
  message: 'observability package type smoke',
  metadata: { package: '@ontrails/observe' },
  timestamp: new Date(0),
});

const createTraceRecord = (): TraceRecord => ({
  attrs: {},
  id: 'span-1',
  kind: 'span',
  name: 'observe.smoke',
  rootId: 'root-1',
  startedAt: 1,
  status: 'ok',
  traceId: 'trace-1',
});

describe('@ontrails/observe', () => {
  test('re-exports core log and trace contracts', async () => {
    const logRecords: LogRecord[] = [];
    const traceRecords: TraceRecord[] = [];
    const messages: string[] = [];
    const context: TraceContext = {
      rootId: 'root-1',
      sampled: true,
      spanId: 'span-1',
      traceId: 'trace-1',
    };
    const capabilities: ObserveCapabilities = { log: true, trace: true };
    const formatter: LogFormatter = {
      format: (record) => `${record.level}:${record.message}`,
    };
    const logSink: LogSink = {
      name: 'capture',
      write: (record) => {
        logRecords.push(record);
      },
    };
    const traceSink: TraceSink = {
      write: (record) => {
        traceRecords.push(record);
      },
    };
    const logger: Logger = {
      child: () => logger,
      debug: (message) => messages.push(message),
      error: (message) => messages.push(message),
      fatal: (message) => messages.push(message),
      info: (message) => messages.push(message),
      name: 'observe.test',
      trace: (message) => messages.push(message),
      warn: (message) => messages.push(message),
    };

    const record = createLogRecord('info');
    logSink.write(record);
    await traceSink.write(createTraceRecord());
    logger.info(context.traceId);

    expect(formatter.format(record)).toBe(
      'info:observability package type smoke'
    );
    expect(logRecords).toEqual([record]);
    expect(traceRecords[0]?.traceId).toBe(context.traceId);
    expect(capabilities).toEqual({ log: true, trace: true });
    expect(messages).toEqual([context.traceId]);
  });
});
