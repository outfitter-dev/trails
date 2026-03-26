import { describe, test, expect } from 'bun:test';

import { resolveLogLevel } from '../env.js';

// ---------------------------------------------------------------------------
// resolveLogLevel
// ---------------------------------------------------------------------------

describe('resolveLogLevel', () => {
  test('reads from TRAILS_LOG_LEVEL', () => {
    expect(resolveLogLevel({ TRAILS_LOG_LEVEL: 'debug' })).toBe('debug');
    expect(resolveLogLevel({ TRAILS_LOG_LEVEL: 'error' })).toBe('error');
    expect(resolveLogLevel({ TRAILS_LOG_LEVEL: 'trace' })).toBe('trace');
  });

  test('TRAILS_LOG_LEVEL takes precedence over TRAILS_ENV', () => {
    expect(
      resolveLogLevel({
        TRAILS_ENV: 'development',
        TRAILS_LOG_LEVEL: 'error',
      })
    ).toBe('error');
  });

  test('falls back to TRAILS_ENV profile defaults', () => {
    expect(resolveLogLevel({ TRAILS_ENV: 'development' })).toBe('debug');
  });

  test('TRAILS_ENV=test returns undefined', () => {
    expect(resolveLogLevel({ TRAILS_ENV: 'test' })).toBeUndefined();
  });

  test('TRAILS_ENV=production returns undefined', () => {
    expect(resolveLogLevel({ TRAILS_ENV: 'production' })).toBeUndefined();
  });

  test('returns undefined when no env is set', () => {
    expect(resolveLogLevel({})).toBeUndefined();
  });

  test('invalid TRAILS_LOG_LEVEL values are ignored', () => {
    expect(resolveLogLevel({ TRAILS_LOG_LEVEL: 'banana' })).toBeUndefined();
    expect(resolveLogLevel({ TRAILS_LOG_LEVEL: '' })).toBeUndefined();
  });

  test('invalid TRAILS_LOG_LEVEL falls through to TRAILS_ENV', () => {
    expect(
      resolveLogLevel({
        TRAILS_ENV: 'development',
        TRAILS_LOG_LEVEL: 'banana',
      })
    ).toBe('debug');
  });
});
