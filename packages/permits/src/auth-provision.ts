import { Result, provision } from '@ontrails/core';

import type { AuthConnector } from './connectors/connector.js';

/**
 * Auth provision — manages the auth connector lifecycle.
 *
 * The v1 factory returns a no-op connector that always succeeds (null permit).
 * Real connector configuration will come through `ProvisionSpec.config`
 * (TRL-91). The mock factory provides a synthetic connector that always
 * succeeds.
 */
export const authProvision = provision<AuthConnector>('auth', {
  create: (_svc) =>
    Result.ok({
      // oxlint-disable-next-line require-await -- stub connector satisfies async interface
      authenticate: async () => Result.ok(null),
    } satisfies AuthConnector),
  description: 'Authentication connector',
  metadata: { category: 'infrastructure' },
  mock: () =>
    ({
      // oxlint-disable-next-line require-await -- mock connector satisfies async interface
      authenticate: async () => Result.ok(null),
    }) satisfies AuthConnector,
});
