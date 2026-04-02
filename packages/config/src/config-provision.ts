/**
 * Config provision — manages resolved config lifecycle.
 *
 * The config is resolved during bootstrap (two-phase init per ADR-010)
 * and registered via `registerConfigState`. This provision reads from the
 * global registry so trails can access it through `configProvision.from(ctx)`.
 */
import { InternalError, Result, provision } from '@ontrails/core';
import { z } from 'zod';

import type { ConfigState } from './registry.js';
import { getConfigState } from './registry.js';

export const configProvision = provision<ConfigState>('config', {
  create: () => {
    const state = getConfigState();
    if (state === undefined) {
      return Result.err(
        new InternalError(
          'Config state not registered — call registerConfigState at bootstrap'
        )
      );
    }
    return Result.ok(state);
  },
  description: 'Resolved application configuration',
  meta: { category: 'infrastructure' },
  mock: (): ConfigState => ({
    resolved: {},
    schema: z.object({}),
  }),
});
