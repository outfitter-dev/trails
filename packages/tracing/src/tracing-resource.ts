import { Result, resource } from '@ontrails/core';

import type { TracingState } from './tracing-state.js';
import { getTracingState } from './tracing-state.js';
import { DEFAULT_SAMPLING } from './sampling.js';
import { toTraceStore } from './stores/dev.js';

/** Default state when no explicit state has been registered. */
const defaultState: TracingState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

/**
 * Telemetry query resource.
 *
 * Exposes the current tracing store, sampling config, and active flag as a
 * single `TracingState` accessible to trails via `tracingResource.from(ctx)`.
 *
 * Unlike config, tracing gracefully defaults when no state is registered —
 * telemetry should never fail to start.
 */
export const tracingResource = resource<TracingState>('tracing', {
  create: () => {
    const state = getTracingState() ?? defaultState;
    return Result.ok({
      ...state,
      store: state.store ? toTraceStore(state.store) : undefined,
    });
  },
  description: 'Telemetry query resource',
  meta: { category: 'infrastructure' },
  mock: (): TracingState => ({ ...defaultState }),
});
