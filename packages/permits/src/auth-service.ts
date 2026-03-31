import { Result, service } from '@ontrails/core';

import type { AuthAdapter } from './adapter.js';

/**
 * Auth service — manages the auth adapter lifecycle.
 *
 * The v1 factory returns a no-op adapter that always succeeds (null permit).
 * Real adapter configuration will come through `ServiceSpec.config` (TRL-91).
 * The mock factory provides a synthetic adapter that always succeeds.
 */
export const authService = service<AuthAdapter>('auth', {
  create: (_svc) =>
    Result.ok({
      // oxlint-disable-next-line require-await -- stub adapter satisfies async interface
      authenticate: async () => Result.ok(null),
    } satisfies AuthAdapter),
  description: 'Authentication adapter',
  metadata: { category: 'infrastructure' },
  mock: () =>
    ({
      // oxlint-disable-next-line require-await -- mock adapter satisfies async interface
      authenticate: async () => Result.ok(null),
    }) satisfies AuthAdapter,
});
