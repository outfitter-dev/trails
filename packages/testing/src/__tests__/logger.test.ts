import { describe, expect, test } from 'bun:test';

import { createTestLogger } from '../logger.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTestLogger: basic operations', () => {
  test('captures info entries', () => {
    const logger = createTestLogger();
    logger.info('hello');
    logger.warn('world');
    expect(logger.entries).toHaveLength(2);
    const [first] = logger.entries;
    expect(first).toBeDefined();
    expect(first?.level).toBe('info');
    expect(first?.message).toBe('hello');
  });

  test('captures warn entries', () => {
    const logger = createTestLogger();
    logger.info('hello');
    logger.warn('world');
    const [, second] = logger.entries;
    expect(second).toBeDefined();
    expect(second?.level).toBe('warn');
    expect(second?.message).toBe('world');
  });

  test('entries contain all logged records', () => {
    const logger = createTestLogger();
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');
    expect(logger.entries).toHaveLength(6);
  });

  test('clear() empties the entries array', () => {
    const logger = createTestLogger();
    logger.info('one');
    logger.info('two');
    expect(logger.entries).toHaveLength(2);
    logger.clear();
    expect(logger.entries).toHaveLength(0);
  });

  test('find() filters entries by predicate', () => {
    const logger = createTestLogger();
    logger.info('alpha');
    logger.warn('beta');
    logger.info('gamma');

    const warnings = logger.find((r) => r.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe('beta');
  });
});

describe('createTestLogger: assertLogged', () => {
  test('passes when matching entry exists', () => {
    const logger = createTestLogger();
    logger.info('operation completed');
    expect(() => logger.assertLogged('info', 'completed')).not.toThrow();
  });

  test('fails when no matching entry exists', () => {
    const logger = createTestLogger();
    logger.info('something else');
    expect(() => logger.assertLogged('error', 'not found')).toThrow(
      /Expected a log entry/
    );
  });
});

describe('createTestLogger: child loggers', () => {
  test('child() captures to the same entries array', () => {
    const logger = createTestLogger();
    const child = logger.child({ component: 'db' });

    logger.info('parent message');
    child.info('child message');

    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[0]?.message).toBe('parent message');
    expect(logger.entries[1]?.message).toBe('child message');
    expect(logger.entries[1]?.metadata).toEqual({ component: 'db' });
  });

  test('child logger inherits parent metadata', () => {
    const logger = createTestLogger();
    const child = logger.child({ requestId: 'abc' });
    const grandchild = child.child({ trailId: 'greet' });

    grandchild.info('deep log');

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.metadata).toEqual({
      requestId: 'abc',
      trailId: 'greet',
    });
  });
});

describe('createTestLogger: configuration', () => {
  test('respects minimum log level', () => {
    const logger = createTestLogger({ level: 'warn' });
    logger.debug('should be filtered');
    logger.info('also filtered');
    logger.warn('should appear');
    logger.error('also appears');
    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[0]?.level).toBe('warn');
    expect(logger.entries[1]?.level).toBe('error');
  });

  test('has name property', () => {
    const logger = createTestLogger();
    expect(logger.name).toBe('test');
  });

  test('entries have timestamps', () => {
    const logger = createTestLogger();
    logger.info('timestamped');
    expect(logger.entries[0]?.timestamp).toBeInstanceOf(Date);
  });

  test('entries have category matching logger name', () => {
    const logger = createTestLogger();
    logger.info('categorized');
    expect(logger.entries[0]?.category).toBe('test');
  });
});
