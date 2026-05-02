import { describe, expect, test } from 'bun:test';

import { ValidationError } from '../errors.js';
import { schedule } from '../schedule.js';

describe('schedule()', () => {
  test('returns frozen inert schedule source data', () => {
    const nightly = schedule('schedule.nightly-close', {
      cron: ' 0   2 * * * ',
      input: { olderThanDays: 90 },
      meta: { owner: 'billing' },
      timezone: 'UTC',
    });

    expect(nightly).toEqual({
      cron: '0 2 * * *',
      id: 'schedule.nightly-close',
      input: { olderThanDays: 90 },
      kind: 'schedule',
      meta: { owner: 'billing' },
      timezone: 'UTC',
    });
    expect(Object.isFrozen(nightly)).toBe(true);
    expect(Object.isFrozen(nightly.meta)).toBe(true);
  });

  test('defaults omitted input to an empty object', () => {
    const heartbeat = schedule({
      cron: '*/5 * * * *',
      id: 'schedule.heartbeat',
    });

    expect(heartbeat.input).toEqual({});
  });

  test('accepts range, list, and step cron fields', () => {
    const weekday = schedule('schedule.weekday', {
      cron: '*/15 9-17 * 1,6 1-5',
      timezone: 'America/New_York',
    });

    expect(weekday.cron).toBe('*/15 9-17 * 1,6 1-5');
    expect(weekday.timezone).toBe('America/New_York');
  });

  test('rejects unsupported cron expressions', () => {
    expect(() =>
      schedule('schedule.invalid', {
        cron: '60 * * * *',
      })
    ).toThrow(ValidationError);
  });

  test('rejects malformed cron range and step separators', () => {
    expect(() =>
      schedule('schedule.invalid-step', {
        cron: '*/2/3 * * * *',
      })
    ).toThrow(ValidationError);

    expect(() =>
      schedule('schedule.invalid-range', {
        cron: '1-2-3 * * * *',
      })
    ).toThrow(ValidationError);
  });

  test('rejects invalid timezones', () => {
    expect(() =>
      schedule('schedule.invalid-zone', {
        cron: '0 2 * * *',
        timezone: 'Not/A_Zone',
      })
    ).toThrow('timezone');
  });

  test('rejects non-json-serializable input', () => {
    expect(() =>
      schedule('schedule.invalid-input', {
        cron: '0 2 * * *',
        input: { startedAt: new Date('2026-05-01T00:00:00Z') },
      })
    ).toThrow('JSON-serializable');

    expect(() =>
      schedule('schedule.undefined-input', {
        cron: '0 2 * * *',
        input: { accountId: undefined },
      })
    ).toThrow('JSON-serializable');
  });
});
