import type { Layer } from '@ontrails/core';

// ---------------------------------------------------------------------------
// Auth layer
// ---------------------------------------------------------------------------

/**
 * Compatibility layer for older apps that still include `authLayer`.
 *
 * @deprecated Permit scope enforcement is an intrinsic `executeTrail` pipeline
 * stage. Keep this layer only while migrating existing app configuration.
 */
export const authLayer: Layer = {
  description: 'Compatibility wrapper; permit enforcement is intrinsic',
  name: 'auth',
  wrap: (_trail, impl) => impl,
};
