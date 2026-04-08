import { DEFAULT_SAMPLING } from './sampling.js';
import type { SamplingConfig } from './sampling.js';
import type { TraceStore } from './stores/dev.js';

/** Full tracing subsystem state carried by tracingResource. */
export interface TracingState {
  readonly active: boolean;
  readonly sampling: SamplingConfig;
  readonly store: TraceStore | undefined;
}

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

// --- Backward-compatible convenience wrappers ---

/** Register a track store instance for use by the tracing.query trail. */
export const registerTraceStore = (s: TraceStore): void => {
  state = {
    active: state?.active ?? true,
    sampling: state?.sampling ?? DEFAULT_SAMPLING,
    store: s,
  };
};

/** Retrieve the currently registered track store, if any. */
export const getTraceStore = (): TraceStore | undefined => state?.store;

/** Clear the registered store. Useful for testing teardown. */
export const clearTraceStore = (): void => {
  if (state) {
    state = { ...state, store: undefined };
  }
};
