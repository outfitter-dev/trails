import { describe, expect, test } from 'bun:test';

import type { LogSink } from './index.js';

/**
 * The small common shape every extracted observability adapter proves through
 * the owner package. Library-specific behavior remains in that adapter's own
 * integration tests.
 */
export interface ObservabilityAdapterConformanceAdapter {
  readonly createSink: () => LogSink;
  readonly name: string;
}

export interface ObservabilityAdapterConformanceCase {
  readonly check: (adapter: ObservabilityAdapterConformanceAdapter) => void;
  readonly name: string;
}

export const createObservabilityAdapterConformanceCases =
  (): readonly ObservabilityAdapterConformanceCase[] => [
    {
      check(adapter): void {
        const sink = adapter.createSink();
        expect(sink.name).toBe(adapter.name);
        sink.write({
          category: 'conformance',
          level: 'silent',
          message: 'must not reach the foreign logger',
          metadata: {},
          timestamp: new Date('2026-07-13T00:00:00.000Z'),
        });
      },
      name: 'creates the named sink and accepts silent records',
    },
  ];

export const runConformance = (
  adapter: ObservabilityAdapterConformanceAdapter,
  cases: readonly ObservabilityAdapterConformanceCase[]
): void => {
  describe(`${adapter.name} observability adapter conformance`, () => {
    for (const conformanceCase of cases) {
      test(conformanceCase.name, () => {
        conformanceCase.check(adapter);
      });
    }
  });
};
