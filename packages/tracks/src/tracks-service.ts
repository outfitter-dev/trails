import { Result, service } from '@ontrails/core';

import type { TracksState } from './registry.js';
import { getTracksState } from './registry.js';
import { DEFAULT_SAMPLING } from './sampling.js';

/** Default state when no explicit state has been registered. */
const defaultState: TracksState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

/**
 * Telemetry recording and query service.
 *
 * Wraps the track store, sampling config, and active flag as a single
 * `TracksState` accessible to trails via `tracksService.from(ctx)`.
 *
 * Unlike config, tracks gracefully defaults when no state is registered —
 * telemetry should never fail to start.
 */
export const tracksService = service<TracksState>('tracks', {
  create: () => Result.ok(getTracksState() ?? defaultState),
  description: 'Telemetry recording and query service',
  metadata: { category: 'infrastructure' },
  mock: (): TracksState => ({ ...defaultState }),
});
