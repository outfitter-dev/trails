import { Result, service } from '@ontrails/core';

import type { CrumbsState } from './registry.js';
import { getCrumbsState } from './registry.js';
import { DEFAULT_SAMPLING } from './sampling.js';

/** Default state when no explicit state has been registered. */
const defaultState: CrumbsState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

/**
 * Telemetry recording and query service.
 *
 * Wraps the crumb store, sampling config, and active flag as a single
 * `CrumbsState` accessible to trails via `crumbsService.from(ctx)`.
 *
 * Unlike config, crumbs gracefully defaults when no state is registered —
 * telemetry should never fail to start.
 */
export const crumbsService = service<CrumbsState>('crumbs', {
  create: () => Result.ok(getCrumbsState() ?? defaultState),
  description: 'Telemetry recording and query service',
  metadata: { category: 'infrastructure' },
  mock: (): CrumbsState => ({ ...defaultState }),
});
