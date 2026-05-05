/**
 * Tests for CLI surface derivation absorbing date-shortcut behavior.
 *
 * Verifies that when a trail's input schema contains date-typed fields,
 * the CLI surface derivation pipeline expands shortcut strings
 * (`today`, `yesterday`, `Nd`, `this-week`, `this-month`) into UTC ISO
 * datetimes before validation. Plain ISO strings pass through unchanged;
 * malformed shortcut-shaped values produce a validation error.
 */

import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  detectDateFieldKinds,
  detectDateFields,
  expandDateShortcut,
  expandDateShortcuts,
} from '../date-shortcuts.js';

// ---------------------------------------------------------------------------
// A fixed reference instant used by every clock-sensitive test.
//
// Wednesday, 2025-03-12T15:30:45.123Z (UTC).
// Day-of-week (UTC): 3 (Wed). ISO week starts Monday — so start-of-week is
// 2025-03-10T00:00:00.000Z.
// ---------------------------------------------------------------------------
const FIXED_NOW = new Date(Date.UTC(2025, 2, 12, 15, 30, 45, 123));

// ---------------------------------------------------------------------------
// detectDateFields
// ---------------------------------------------------------------------------

describe('detectDateFields', () => {
  test('detects z.iso.datetime() fields', () => {
    const schema = z.object({
      name: z.string(),
      since: z.iso.datetime(),
      until: z.iso.datetime(),
    });
    const fields = detectDateFields(schema);
    expect(fields.includes('since')).toBe(true);
    expect(fields.includes('until')).toBe(true);
    expect(fields.includes('name')).toBe(false);
  });

  test('detects z.string().datetime() fields', () => {
    const schema = z.object({
      name: z.string(),
      since: z.string().datetime(),
    });
    const fields = detectDateFields(schema);
    expect(fields.includes('since')).toBe(true);
    expect(fields.includes('name')).toBe(false);
  });

  test('detects z.iso.date() fields', () => {
    const schema = z.object({
      day: z.iso.date(),
    });
    const fields = detectDateFields(schema);
    expect(fields.includes('day')).toBe(true);
    expect(detectDateFieldKinds(schema)['day']).toBe('date');
  });

  test('detects z.date() fields', () => {
    const schema = z.object({
      occurredAt: z.date(),
    });
    const fields = detectDateFields(schema);
    expect(fields.includes('occurredAt')).toBe(true);
    expect(detectDateFieldKinds(schema)['occurredAt']).toBe('native-date');
  });

  test('unwraps optional and default wrappers', () => {
    const schema = z.object({
      asOf: z.iso.datetime().default('2025-01-01T00:00:00.000Z'),
      since: z.iso.datetime().optional(),
      until: z.iso.datetime().nullable(),
    });
    const fields = detectDateFields(schema);
    expect(fields.includes('since')).toBe(true);
    expect(fields.includes('until')).toBe(true);
    expect(fields.includes('asOf')).toBe(true);
  });

  test('returns an empty list for a non-date schema', () => {
    const schema = z.object({
      count: z.number(),
      name: z.string(),
    });
    const fields = detectDateFields(schema);
    expect(fields.length).toBe(0);
  });

  test('returns an empty list for non-object schemas', () => {
    expect(detectDateFields(z.string()).length).toBe(0);
    expect(detectDateFields(z.array(z.string())).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// expandDateShortcut — pure expansion
// ---------------------------------------------------------------------------

describe('expandDateShortcut', () => {
  test("'today' expands to start-of-today UTC", () => {
    const result = expandDateShortcut('today', FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('2025-03-12T00:00:00.000Z');
    }
  });

  test("'today' expands to a date-only string for date-only fields", () => {
    const result = expandDateShortcut('today', FIXED_NOW, 'date');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('2025-03-12');
    }
  });

  test("'yesterday' expands to start-of-yesterday UTC", () => {
    const result = expandDateShortcut('yesterday', FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('2025-03-11T00:00:00.000Z');
    }
  });

  test("'7d' expands to N days ago UTC", () => {
    const result = expandDateShortcut('7d', FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('2025-03-05T00:00:00.000Z');
    }
  });

  test("'30d' expands across month boundaries", () => {
    const result = expandDateShortcut('30d', FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('2025-02-10T00:00:00.000Z');
    }
  });

  test('out-of-range rolling day shortcuts return a validation failure', () => {
    const result = expandDateShortcut('999999d', FIXED_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('between 0d and 36500d');
    }
  });

  test("'this-month' expands to first-of-this-month UTC", () => {
    const result = expandDateShortcut('this-month', FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('2025-03-01T00:00:00.000Z');
    }
  });

  test("'this-week' expands to start-of-week (Monday) UTC", () => {
    // 2025-03-12 is a Wednesday; Monday of that week is 2025-03-10.
    const result = expandDateShortcut('this-week', FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('2025-03-10T00:00:00.000Z');
    }
  });

  test("'this-week' on a Sunday treats Sunday as end-of-week", () => {
    // 2025-03-09 is a Sunday; Monday-of-week is 2025-03-03.
    const sunday = new Date(Date.UTC(2025, 2, 9, 12, 0, 0, 0));
    const result = expandDateShortcut('this-week', sunday);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('2025-03-03T00:00:00.000Z');
    }
  });

  test('plain ISO strings pass through unchanged', () => {
    const iso = '2025-01-15T12:34:56.789Z';
    const result = expandDateShortcut(iso, FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(iso);
    }
  });

  test('compact ISO basic datetimes pass through unchanged', () => {
    const iso = '20250115T120000Z';
    const result = expandDateShortcut(iso, FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(iso);
    }
  });

  test("plain date-only strings (e.g. '2025-01-15') pass through", () => {
    const date = '2025-01-15';
    const result = expandDateShortcut(date, FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(date);
    }
  });

  test("invalid Nd-shaped values (e.g. '7day', 'd7') return an error", () => {
    const bad = expandDateShortcut('7day', FIXED_NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toContain('today');
      expect(bad.message).toContain('yesterday');
    }
  });

  test('arbitrary non-shortcut strings pass through (treated as ISO)', () => {
    // The expander does not validate ISO; that is Zod's job. It only
    // intercepts strings that match the shortcut vocabulary or
    // shortcut-like patterns.
    const result = expandDateShortcut('not-a-date', FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('not-a-date');
    }
  });
});

// ---------------------------------------------------------------------------
// expandDateShortcuts — record-level transform
// ---------------------------------------------------------------------------

describe('expandDateShortcuts', () => {
  test('expands matching date fields and leaves others alone', () => {
    const input = {
      count: 5,
      name: 'today',
      since: 'today',
      until: '7d',
    };
    const result = expandDateShortcuts(input, ['since', 'until'], FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['since']).toBe('2025-03-12T00:00:00.000Z');
      expect(result.value['until']).toBe('2025-03-05T00:00:00.000Z');
      expect(result.value['name']).toBe('today');
      expect(result.value['count']).toBe(5);
    }
  });

  test('date-only fields keep shortcut expansions in YYYY-MM-DD form', () => {
    const input = {
      day: 'today',
      since: 'today',
    };
    const result = expandDateShortcuts(input, ['day', 'since'], FIXED_NOW, {
      day: 'date',
      since: 'datetime',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['day']).toBe('2025-03-12');
      expect(result.value['since']).toBe('2025-03-12T00:00:00.000Z');
    }
  });

  test('native z.date fields expand shortcuts to Date instances', () => {
    const input = {
      occurredAt: 'today',
    };
    const result = expandDateShortcuts(input, ['occurredAt'], FIXED_NOW, {
      occurredAt: 'native-date',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['occurredAt']).toBeInstanceOf(Date);
      expect((result.value['occurredAt'] as Date).toISOString()).toBe(
        '2025-03-12T00:00:00.000Z'
      );
    }
  });

  test('non-string values on date fields pass through unchanged', () => {
    const realDate = new Date(Date.UTC(2024, 0, 1));
    const input: Record<string, unknown> = {
      since: realDate,
      until: undefined,
    };
    const result = expandDateShortcuts(input, ['since', 'until'], FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['since']).toBe(realDate);
      expect(result.value['until']).toBe(undefined);
    }
  });

  test('invalid shortcut on a date field surfaces an error', () => {
    const input = { since: '7day' };
    const result = expandDateShortcuts(input, ['since'], FIXED_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('since');
      expect(result.message).toContain('7day');
    }
  });

  test('with no date fields, the input is returned as-is', () => {
    const input = { name: 'anything', since: 'today' };
    const result = expandDateShortcuts(input, [], FIXED_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Same value, no transform applied (still 'today' because field
      // wasn't recognized as a date).
      expect(result.value['since']).toBe('today');
    }
  });
});
