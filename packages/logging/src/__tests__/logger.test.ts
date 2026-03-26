import { describe, test, expect } from 'bun:test';

import { createLogger } from '../logger.js';
import type { LogRecord, LogSink } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const captureSink = (): { records: LogRecord[]; sink: LogSink } => {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    name: 'capture',
    write(record: LogRecord): void {
      records.push(record);
    },
  };
  return { records, sink };
};

// ---------------------------------------------------------------------------
// createLogger basics
// ---------------------------------------------------------------------------

describe('createLogger', () => {
  test('produces a working logger with default config', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({ name: 'app', sinks: [sink] });

    logger.info('hello');
    expect(records).toHaveLength(1);
    const [first] = records;
    expect(first?.message).toBe('hello');
    expect(first?.category).toBe('app');
    expect(first?.level).toBe('info');
  });

  test('logger.name returns the category', () => {
    const logger = createLogger({ name: 'my.app', sinks: [] });
    expect(logger.name).toBe('my.app');
  });

  test('logger with no sinks does not throw', () => {
    const logger = createLogger({ name: 'silent', sinks: [] });
    expect(() => logger.info('hello')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Level methods
// ---------------------------------------------------------------------------

describe('log level methods', () => {
  test('all six methods dispatch to sinks at appropriate levels', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      sinks: [sink],
    });

    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');

    expect(records).toHaveLength(6);
    expect(records.map((r) => r.level)).toEqual([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ]);
  });

  test('messages below configured level are suppressed', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'warn',
      name: 'app',
      sinks: [sink],
    });

    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
  });
});

// ---------------------------------------------------------------------------
// child()
// ---------------------------------------------------------------------------

describe('child()', () => {
  test('inherits parent config and merges metadata', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      sinks: [sink],
    });

    const child = logger.child({ requestId: 'r1' });
    child.info('hello');

    expect(records).toHaveLength(1);
    const [first] = records;
    expect(first?.metadata).toEqual({ requestId: 'r1' });
  });

  test('child logger metadata appears on every log record', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      sinks: [sink],
    });

    const child = logger.child({ traceId: 't1' });
    child.info('a');
    child.warn('b');

    expect(records[0]?.metadata).toEqual({ traceId: 't1' });
    expect(records[1]?.metadata).toEqual({ traceId: 't1' });
  });

  test('multiple child() calls compose metadata correctly', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      sinks: [sink],
    });

    const child1 = logger.child({ requestId: 'r1' });
    const child2 = child1.child({ userId: 'u1' });
    child2.info('hello');

    const [first] = records;
    expect(first?.metadata).toEqual({ requestId: 'r1', userId: 'u1' });
  });

  test('child metadata merges with per-call metadata', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      sinks: [sink],
    });

    const child = logger.child({ requestId: 'r1' });
    child.info('hello', { extra: true });

    const [first] = records;
    expect(first?.metadata).toEqual({ extra: true, requestId: 'r1' });
  });

  test('child preserves parent name', () => {
    const logger = createLogger({ name: 'app.db', sinks: [] });
    const child = logger.child({ rid: 'x' });
    expect(child.name).toBe('app.db');
  });
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

describe('redaction', () => {
  test('redaction is applied to messages before sink dispatch', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      sinks: [sink],
    });

    logger.info('card: 4111-1111-1111-1111');
    const [first] = records;
    expect(first?.message).toBe('card: [REDACTED]');
  });

  test('redaction is applied to metadata before sink dispatch', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      sinks: [sink],
    });

    logger.info('hello', { password: 's3cret' });
    const [first] = records;
    expect(first?.metadata['password']).toBe('[REDACTED]');
  });

  test('default redaction scrubs patterns matching DEFAULT_PATTERNS', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      sinks: [sink],
    });

    logger.info('key: sk-abc123def456ghi');
    const [first] = records;
    expect(first?.message).toBe('key: [REDACTED]');
  });

  test('default redaction scrubs keys matching DEFAULT_SENSITIVE_KEYS', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      sinks: [sink],
    });

    logger.info('auth', { apiKey: 'key-123', token: 'secret-value' });
    const [first] = records;
    expect(first?.metadata['token']).toBe('[REDACTED]');
    expect(first?.metadata['apiKey']).toBe('[REDACTED]');
  });

  test('custom redaction patterns are applied when provided', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'trace',
      name: 'app',
      redaction: {
        patterns: [/secret-\w+/g],
      },
      sinks: [sink],
    });

    logger.info('found secret-banana here');
    const [first] = records;
    expect(first?.message).toBe('found [REDACTED] here');
  });
});

// ---------------------------------------------------------------------------
// Hierarchical category filtering
// ---------------------------------------------------------------------------

describe('hierarchical category filtering', () => {
  test('uses category-specific level', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'info',
      levels: { 'app.db': 'debug' },
      name: 'app.db',
      sinks: [sink],
    });

    logger.debug('query executed');
    expect(records).toHaveLength(1);
  });

  test('walks up to parent category level', () => {
    const { records, sink } = captureSink();
    const logger = createLogger({
      level: 'error',
      levels: { 'app.db': 'debug' },
      name: 'app.db.queries',
      sinks: [sink],
    });

    logger.debug('query executed');
    expect(records).toHaveLength(1);
  });
});
