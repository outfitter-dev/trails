import { DEFAULT_SAMPLING } from './sampling.js';
import type { SamplingConfig } from './sampling.js';
import type { DevStore } from './stores/dev.js';

/** Full telemetry subsystem state carried by tracksService. */
export interface TracksState {
  readonly active: boolean;
  readonly sampling: SamplingConfig;
  readonly store: DevStore | undefined;
}

let state: TracksState | undefined;

/** Register telemetry state at bootstrap. */
export const registerTracksState = (s: TracksState): void => {
  state = s;
};

/** Read the registered telemetry state. Returns `undefined` before registration. */
export const getTracksState = (): TracksState | undefined => state;

/** Clear registered state. Primarily useful in tests. */
export const clearTracksState = (): void => {
  state = undefined;
};

// --- Backward-compatible convenience wrappers ---

/** Register a DevStore instance for use by the tracks.query trail. */
export const registerTrackStore = (s: DevStore): void => {
  state = {
    active: state?.active ?? true,
    sampling: state?.sampling ?? DEFAULT_SAMPLING,
    store: s,
  };
};

/** Retrieve the currently registered DevStore, if any. */
export const getTrackStore = (): DevStore | undefined => state?.store;

/** Clear the registered store. Useful for testing teardown. */
export const clearTrackStore = (): void => {
  if (state) {
    state = { ...state, store: undefined };
  }
};
