import { describe, expect, test } from 'bun:test';

import type { TraceSink } from '../internal/tracing.js';
import { isObserveInput, normalizeObserve } from '../observe.js';
import type { LogSink, Logger } from '../types.js';

const makeLogger = (): Logger => ({
  child: () => makeLogger(),
  debug: () => {},
  error: () => {},
  fatal: () => {},
  info: () => {},
  name: 'test',
  trace: () => {},
  warn: () => {},
});

describe('isObserveInput', () => {
  test('accepts undefined', () => {
    expect(isObserveInput()).toBe(true);
  });

  test('accepts a Logger', () => {
    expect(isObserveInput(makeLogger())).toBe(true);
  });

  test('accepts an explicit ObserveConfig with log', () => {
    expect(isObserveInput({ log: makeLogger() })).toBe(true);
  });

  test('accepts an explicit ObserveConfig with trace', () => {
    const trace: TraceSink = { write: () => {} };
    expect(isObserveInput({ trace })).toBe(true);
  });

  test('accepts a bare TraceSink (no name)', () => {
    const trace: TraceSink = { write: () => {} };
    expect(isObserveInput(trace)).toBe(true);
  });

  test('rejects capability-only payloads', () => {
    // The exported guard must agree with `normalizeObserve`. A bare
    // capability declaration without an accompanying `write` method is
    // metadata about a missing implementation, not a valid input.
    expect(isObserveInput({ observes: { trace: true } })).toBe(false);
    expect(isObserveInput({ observes: { log: true } })).toBe(false);
    expect(isObserveInput({ observes: { log: true, trace: true } })).toBe(
      false
    );
  });

  test('rejects bare LogSink shorthand (ambiguous with TraceSink)', () => {
    // `normalizeObserve` rejects bare LogSink shorthand because the shape
    // is ambiguous between a log sink and a trace sink. The guard must
    // match that behavior so callers do not narrow to `ObserveInput` and
    // then watch normalization throw.
    const log: LogSink = { name: 'capture', write: () => {} };
    expect(isObserveInput(log)).toBe(false);
  });

  test('rejects unrelated objects', () => {
    expect(isObserveInput({})).toBe(false);
    expect(isObserveInput({ foo: 'bar' })).toBe(false);
    expect(isObserveInput(42)).toBe(false);
    expect(isObserveInput('observe')).toBe(false);
    expect(isObserveInput(null)).toBe(false);
  });

  test('guard remains consistent with normalizeObserve', () => {
    // For every value the guard accepts, `normalizeObserve` must not
    // throw. Capability-only and bare LogSink inputs would throw, so
    // they must be rejected by the guard above.
    const trace: TraceSink = { write: () => {} };
    const accepted: readonly unknown[] = [
      undefined,
      makeLogger(),
      { log: makeLogger() },
      { trace },
      trace,
    ];
    for (const value of accepted) {
      expect(isObserveInput(value)).toBe(true);
      expect(() =>
        normalizeObserve(value as Parameters<typeof normalizeObserve>[0])
      ).not.toThrow();
    }
  });
});
