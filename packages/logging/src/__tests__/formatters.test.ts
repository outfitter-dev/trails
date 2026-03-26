import { describe, test, expect } from 'bun:test';

import { createJsonFormatter, createPrettyFormatter } from '../formatters.js';
import type { LogRecord } from '../types.js';

const makeRecord = (overrides?: Partial<LogRecord>): LogRecord => ({
  category: 'app.entity',
  level: 'info',
  message: 'Entity created',
  metadata: { entityId: 'e1', requestId: 'abc-123' },
  timestamp: new Date('2026-03-25T10:00:00.000Z'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// createJsonFormatter
// ---------------------------------------------------------------------------

describe('createJsonFormatter', () => {
  test('produces valid JSON with all record fields', () => {
    const formatter = createJsonFormatter();
    const output = formatter.format(makeRecord());
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed['level']).toBe('info');
    expect(parsed['message']).toBe('Entity created');
    expect(parsed['category']).toBe('app.entity');
    expect(parsed['timestamp']).toBe('2026-03-25T10:00:00.000Z');
  });

  test('flattens metadata into top-level object', () => {
    const formatter = createJsonFormatter();
    const output = formatter.format(makeRecord());
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed['requestId']).toBe('abc-123');
    expect(parsed['entityId']).toBe('e1');
    // metadata key itself should not appear
    expect(parsed['metadata']).toBeUndefined();
  });

  test('handles empty metadata', () => {
    const formatter = createJsonFormatter();
    const output = formatter.format(makeRecord({ metadata: {} }));
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed['level']).toBe('info');
    expect(parsed['message']).toBe('Entity created');
  });

  test('handles metadata with nested objects', () => {
    const formatter = createJsonFormatter();
    const output = formatter.format(
      makeRecord({ metadata: { user: { id: 1 } } })
    );
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed['user']).toEqual({ id: 1 });
  });
});

// ---------------------------------------------------------------------------
// createPrettyFormatter
// ---------------------------------------------------------------------------

describe('createPrettyFormatter', () => {
  test('produces human-readable output with level, category, and message', () => {
    const formatter = createPrettyFormatter({ colors: false });
    const output = formatter.format(makeRecord());

    expect(output).toContain('INFO');
    expect(output).toContain('[app.entity]');
    expect(output).toContain('Entity created');
  });

  test('includes metadata as key=value pairs', () => {
    const formatter = createPrettyFormatter({ colors: false });
    const output = formatter.format(makeRecord());

    expect(output).toContain('requestId=abc-123');
    expect(output).toContain('entityId=e1');
  });

  test('respects timestamps: false', () => {
    const formatter = createPrettyFormatter({
      colors: false,
      timestamps: false,
    });
    const output = formatter.format(makeRecord());

    // Should NOT contain the time portion
    expect(output).not.toContain('10:00:00');
    // Should still contain message
    expect(output).toContain('Entity created');
  });

  test('includes timestamp by default', () => {
    const formatter = createPrettyFormatter({ colors: false });
    const output = formatter.format(makeRecord());

    expect(output).toContain('10:00:00');
  });

  test('respects colors: false', () => {
    const formatter = createPrettyFormatter({ colors: false });
    const output = formatter.format(makeRecord());

    // No ANSI escape codes
    expect(output).not.toContain('\u001B[');
  });

  test('adds ANSI escape codes when colors: true', () => {
    const formatter = createPrettyFormatter({ colors: true });
    const output = formatter.format(makeRecord());

    // Should contain ANSI color codes
    expect(output).toContain('\u001B[');
  });
});
