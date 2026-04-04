import { Result, provision } from '@ontrails/core';

import type { TrackerState } from './tracker-state.js';
import { getTrackerState } from './tracker-state.js';
import { DEFAULT_SAMPLING } from './sampling.js';
import { toTrackStore } from './stores/dev.js';

/** Default state when no explicit state has been registered. */
const defaultState: TrackerState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

/**
 * Telemetry recording and query provision.
 *
 * Wraps the tracker store, sampling config, and active flag as a single
 * `TrackerState` accessible to trails via `trackerProvision.from(ctx)`.
 *
 * Unlike config, tracker gracefully defaults when no state is registered —
 * telemetry should never fail to start.
 */
export const trackerProvision = provision<TrackerState>('tracker', {
  create: () => {
    const state = getTrackerState() ?? defaultState;
    return Result.ok({
      ...state,
      store: state.store ? toTrackStore(state.store) : undefined,
    });
  },
  description: 'Telemetry recording and query provision',
  meta: { category: 'infrastructure' },
  mock: (): TrackerState => ({ ...defaultState }),
});
