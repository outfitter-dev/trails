import { Result, resource } from '@ontrails/core';

import type { TrackerState } from './tracing-state.js';
import { getTrackerState } from './tracing-state.js';
import { DEFAULT_SAMPLING } from './sampling.js';
import { toTraceStore } from './stores/dev.js';

/** Default state when no explicit state has been registered. */
const defaultState: TrackerState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

/**
 * Telemetry recording and query resource.
 *
 * Wraps the tracing store, sampling config, and active flag as a single
 * `TrackerState` accessible to trails via `trackerProvision.from(ctx)`.
 *
 * Unlike config, tracing gracefully defaults when no state is registered —
 * telemetry should never fail to start.
 */
export const trackerProvision = resource<TrackerState>('tracing', {
  create: () => {
    const state = getTrackerState() ?? defaultState;
    return Result.ok({
      ...state,
      store: state.store ? toTraceStore(state.store) : undefined,
    });
  },
  description: 'Telemetry recording and query resource',
  meta: { category: 'infrastructure' },
  mock: (): TrackerState => ({ ...defaultState }),
});
