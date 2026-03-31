import { DEFAULT_SAMPLING } from './sampling.js';
import type { SamplingConfig } from './sampling.js';
import type { DevStore } from './stores/dev.js';

/** Full telemetry subsystem state carried by crumbsService. */
export interface CrumbsState {
  readonly active: boolean;
  readonly sampling: SamplingConfig;
  readonly store: DevStore | undefined;
}

let state: CrumbsState | undefined;

/** Register telemetry state at bootstrap. */
export const registerCrumbsState = (s: CrumbsState): void => {
  state = s;
};

/** Read the registered telemetry state. Returns `undefined` before registration. */
export const getCrumbsState = (): CrumbsState | undefined => state;

/** Clear registered state. Primarily useful in tests. */
export const clearCrumbsState = (): void => {
  state = undefined;
};

// --- Backward-compatible convenience wrappers ---

/** Register a DevStore instance for use by the crumbs.query trail. */
export const registerCrumbStore = (s: DevStore): void => {
  state = {
    active: state?.active ?? true,
    sampling: state?.sampling ?? DEFAULT_SAMPLING,
    store: s,
  };
};

/** Retrieve the currently registered DevStore, if any. */
export const getCrumbStore = (): DevStore | undefined => state?.store;

/** Clear the registered store. Useful for testing teardown. */
export const clearCrumbStore = (): void => {
  if (state) {
    state = { ...state, store: undefined };
  }
};
