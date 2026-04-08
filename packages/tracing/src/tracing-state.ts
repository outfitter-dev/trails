import { DEFAULT_SAMPLING } from './sampling.js';
import type { SamplingConfig } from './sampling.js';
import type { TraceStore } from './stores/dev.js';

/** Full telemetry subsystem state carried by tracingResource. */
export interface TracingState {
  readonly active: boolean;
  readonly sampling: SamplingConfig;
  readonly store: TraceStore | undefined;
}

// oxlint-disable-next-line eslint-plugin-jest/require-hook -- module-level state registry, not test setup
let state: TracingState | undefined;

/** Register telemetry state at bootstrap. */
export const registerTracingState = (s: TracingState): void => {
  state = s;
};

/** Read the registered telemetry state. Returns `undefined` before registration. */
export const getTracingState = (): TracingState | undefined => state;

/** Clear registered state. Primarily useful in tests. */
export const clearTracingState = (): void => {
  state = undefined;
};

// --- Convenience wrappers for store-only registration ---

/** Register a trace store instance for use by the tracing.query trail. */
export const registerTraceStore = (s: TraceStore): void => {
  state = {
    active: state?.active ?? true,
    sampling: state?.sampling ?? DEFAULT_SAMPLING,
    store: s,
  };
};

/** Retrieve the currently registered trace store, if any. */
export const getTraceStore = (): TraceStore | undefined => state?.store;

/** Clear the registered store. Useful for testing teardown. */
export const clearTraceStore = (): void => {
  if (state) {
    state = { ...state, store: undefined };
  }
};
