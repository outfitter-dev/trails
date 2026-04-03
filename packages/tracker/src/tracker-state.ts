import { DEFAULT_SAMPLING } from './sampling.js';
import type { SamplingConfig } from './sampling.js';
import type { TrackStore } from './stores/dev.js';

/** Full telemetry subsystem state carried by trackerProvision. */
export interface TrackerState {
  readonly active: boolean;
  readonly sampling: SamplingConfig;
  readonly store: TrackStore | undefined;
}

let state: TrackerState | undefined;

/** Register telemetry state at bootstrap. */
export const registerTrackerState = (s: TrackerState): void => {
  state = s;
};

/** Read the registered telemetry state. Returns `undefined` before registration. */
export const getTrackerState = (): TrackerState | undefined => state;

/** Clear registered state. Primarily useful in tests. */
export const clearTrackerState = (): void => {
  state = undefined;
};

// --- Backward-compatible convenience wrappers ---

/** Register a track store instance for use by the tracker.query trail. */
export const registerTrackStore = (s: TrackStore): void => {
  state = {
    active: state?.active ?? true,
    sampling: state?.sampling ?? DEFAULT_SAMPLING,
    store: s,
  };
};

/** Retrieve the currently registered track store, if any. */
export const getTrackStore = (): TrackStore | undefined => state?.store;

/** Clear the registered store. Useful for testing teardown. */
export const clearTrackStore = (): void => {
  if (state) {
    state = { ...state, store: undefined };
  }
};
