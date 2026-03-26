import { describe, test, expect } from 'bun:test';

import { shouldLog, resolveCategory, LEVEL_PRIORITY } from '../levels.js';

// ---------------------------------------------------------------------------
// LEVEL_PRIORITY
// ---------------------------------------------------------------------------

describe('LEVEL_PRIORITY', () => {
  test('trace < debug < info < warn < error < fatal < silent', () => {
    expect(LEVEL_PRIORITY.trace).toBeLessThan(LEVEL_PRIORITY.debug);
    expect(LEVEL_PRIORITY.debug).toBeLessThan(LEVEL_PRIORITY.info);
    expect(LEVEL_PRIORITY.info).toBeLessThan(LEVEL_PRIORITY.warn);
    expect(LEVEL_PRIORITY.warn).toBeLessThan(LEVEL_PRIORITY.error);
    expect(LEVEL_PRIORITY.error).toBeLessThan(LEVEL_PRIORITY.fatal);
    expect(LEVEL_PRIORITY.fatal).toBeLessThan(LEVEL_PRIORITY.silent);
  });
});

// ---------------------------------------------------------------------------
// shouldLog
// ---------------------------------------------------------------------------

describe('shouldLog', () => {
  test('returns true when message level >= configured level', () => {
    expect(shouldLog('info', 'info')).toBe(true);
    expect(shouldLog('warn', 'info')).toBe(true);
    expect(shouldLog('error', 'debug')).toBe(true);
    expect(shouldLog('fatal', 'trace')).toBe(true);
  });

  test('returns false when message level < configured level', () => {
    expect(shouldLog('debug', 'info')).toBe(false);
    expect(shouldLog('trace', 'warn')).toBe(false);
    expect(shouldLog('info', 'error')).toBe(false);
  });

  test('silent level suppresses all messages', () => {
    expect(shouldLog('trace', 'silent')).toBe(false);
    expect(shouldLog('debug', 'silent')).toBe(false);
    expect(shouldLog('info', 'silent')).toBe(false);
    expect(shouldLog('warn', 'silent')).toBe(false);
    expect(shouldLog('error', 'silent')).toBe(false);
    expect(shouldLog('fatal', 'silent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveCategory
// ---------------------------------------------------------------------------

describe('resolveCategory', () => {
  test('returns exact match for a full category name', () => {
    const levels = { 'app.db.queries': 'debug' as const };
    expect(resolveCategory('app.db.queries', levels, 'info')).toBe('debug');
  });

  test('walks up hierarchy: app.db.queries -> app.db -> app', () => {
    const levels = { app: 'warn' as const, 'app.db': 'debug' as const };
    // "app.db.queries" not found, falls to "app.db"
    expect(resolveCategory('app.db.queries', levels, 'info')).toBe('debug');
  });

  test('walks all the way to parent prefix', () => {
    const levels = { app: 'error' as const };
    expect(resolveCategory('app.db.queries', levels, 'info')).toBe('error');
  });

  test('returns fallback when no prefix matches', () => {
    const levels = { other: 'debug' as const };
    expect(resolveCategory('app.db.queries', levels, 'info')).toBe('info');
  });

  test('returns fallback when levels is undefined', () => {
    expect(resolveCategory('app.db', undefined, 'warn')).toBe('warn');
  });

  test('returns fallback when category has no dots and no match', () => {
    const levels = { other: 'debug' as const };
    expect(resolveCategory('app', levels, 'info')).toBe('info');
  });
});
