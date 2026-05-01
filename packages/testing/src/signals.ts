import { isDeepStrictEqual } from 'node:util';

import type {
  FireFn,
  TrailContext,
  TrailExample,
  TrailExampleSignalAssertion,
} from '@ontrails/core';
import { summarizeSignalPayload } from '@ontrails/core';

export interface RecordedSignal {
  readonly payload: unknown;
  readonly signalId: string;
}

export interface SignalAssertionHarness {
  readonly assert: () => void;
  readonly ctx: TrailContext;
}

const noop = (): void => undefined;

const resolveSignalId = (signal: unknown): string => {
  if (typeof signal === 'string') {
    return signal;
  }
  if (
    typeof signal === 'object' &&
    signal !== null &&
    'id' in signal &&
    typeof (signal as { readonly id: unknown }).id === 'string'
  ) {
    return (signal as { readonly id: string }).id;
  }
  return '<unknown signal>';
};

const assertionSignalId = (assertion: TrailExampleSignalAssertion): string =>
  resolveSignalId(assertion.signal);

const formatPayloadSummary = (payload: unknown): string => {
  const summary = summarizeSignalPayload(payload);
  const parts = [
    `redacted=${summary.redacted}`,
    `shape=${summary.shape}`,
    `digest=${summary.digest}`,
  ];
  if (summary.topLevelEntryCount !== undefined) {
    parts.push(`topLevelEntryCount=${summary.topLevelEntryCount}`);
  }
  return `{${parts.join(' ')}}`;
};

const formatAssertion = (assertion: TrailExampleSignalAssertion): string => {
  const parts = [`signal=${assertionSignalId(assertion)}`];
  if (assertion.payload !== undefined) {
    parts.push(`payloadSummary=${formatPayloadSummary(assertion.payload)}`);
  }
  if (assertion.payloadMatch !== undefined) {
    parts.push(
      `payloadMatchSummary=${formatPayloadSummary(assertion.payloadMatch)}`
    );
  }
  if (assertion.times !== undefined) {
    parts.push(`times=${assertion.times}`);
  }
  return parts.join(' ');
};

const formatObserved = (observed: readonly RecordedSignal[]): string => {
  if (observed.length === 0) {
    return '<none>';
  }
  return observed
    .map(
      (record) =>
        `${record.signalId} payloadSummary=${formatPayloadSummary(record.payload)}`
    )
    .join('; ');
};

const subsetArrayMatches = (
  actual: readonly unknown[],
  expected: readonly unknown[]
): boolean => {
  const consumed = new Set<number>();
  for (const expectedItem of expected) {
    const matchIndex = actual.findIndex(
      (actualItem, index) =>
        !consumed.has(index) &&
        // oxlint-disable-next-line no-use-before-define -- mutual recursion with subsetMatches
        subsetMatches(actualItem, expectedItem)
    );
    if (matchIndex === -1) {
      return false;
    }
    consumed.add(matchIndex);
  }
  return true;
};

const subsetObjectMatches = (
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean =>
  Object.keys(expected).every(
    (key) =>
      key in actual &&
      // oxlint-disable-next-line no-use-before-define -- mutual recursion with subsetMatches
      subsetMatches(actual[key], expected[key])
  );

const subsetMatches = (actual: unknown, expected: unknown): boolean => {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && subsetArrayMatches(actual, expected);
  }
  if (expected !== null && typeof expected === 'object') {
    return (
      actual !== null &&
      typeof actual === 'object' &&
      !Array.isArray(actual) &&
      subsetObjectMatches(
        actual as Record<string, unknown>,
        expected as Record<string, unknown>
      )
    );
  }
  return isDeepStrictEqual(actual, expected);
};

const payloadMatches = (
  payload: unknown,
  assertion: TrailExampleSignalAssertion
): boolean => {
  if (
    assertion.payload !== undefined &&
    !isDeepStrictEqual(payload, assertion.payload)
  ) {
    return false;
  }
  if (
    assertion.payloadMatch !== undefined &&
    !subsetMatches(payload, assertion.payloadMatch)
  ) {
    return false;
  }
  return true;
};

const signalMatches = (
  record: RecordedSignal,
  assertion: TrailExampleSignalAssertion
): boolean =>
  record.signalId === assertionSignalId(assertion) &&
  payloadMatches(record.payload, assertion);

const assertValidTimes = (assertion: TrailExampleSignalAssertion): number => {
  const times = assertion.times ?? 1;
  if (!Number.isInteger(times) || times < 1) {
    throw new Error(
      `Signal assertion has invalid times value: ${formatAssertion(assertion)}`
    );
  }
  return times;
};

const assertSignalAssertion = (
  example: TrailExample<unknown, unknown>,
  assertion: TrailExampleSignalAssertion,
  observed: readonly RecordedSignal[],
  consumed: Set<number>
): void => {
  const times = assertValidTimes(assertion);
  for (let count = 0; count < times; count += 1) {
    const matchIndex = observed.findIndex(
      (record, index) =>
        !consumed.has(index) && signalMatches(record, assertion)
    );
    if (matchIndex === -1) {
      throw new Error(
        `Example "${example.name}" expected signal ${formatAssertion(
          assertion
        )}; observed ${formatObserved(observed)}`
      );
    }
    consumed.add(matchIndex);
  }
};

export const assertSignalAssertions = (
  example: TrailExample<unknown, unknown>,
  observed: readonly RecordedSignal[]
): void => {
  const consumed = new Set<number>();
  for (const assertion of example.signals ?? []) {
    assertSignalAssertion(example, assertion, observed, consumed);
  }
};

export const withSignalAssertions = (
  ctx: TrailContext,
  example: TrailExample<unknown, unknown>
): SignalAssertionHarness => {
  if (example.signals === undefined || example.signals.length === 0) {
    return { assert: noop, ctx };
  }

  const observed: RecordedSignal[] = [];
  const baseFire = ctx.fire as
    | ((signal: unknown, payload: unknown) => Promise<void>)
    | undefined;
  const fire = (async (signal: unknown, payload: unknown): Promise<void> => {
    observed.push({ payload, signalId: resolveSignalId(signal) });
    await baseFire?.(signal, payload);
  }) as FireFn;

  return {
    assert: () => assertSignalAssertions(example, observed),
    ctx: { ...ctx, fire },
  };
};
