/**
 * Config layer — attaches resolved config to the execution context.
 *
 * For v1, the layer is a pass-through: config resolution happens at
 * bootstrap time and the resource pipeline (TRL-91) injects the resolved
 * config before any trail runs. The layer reserves a named slot so future
 * versions can add per-trail config overrides or validation.
 */
import type { Layer } from '@ontrails/core';

export const configGate: Layer = {
  description: 'Ensures resolved config is available in the execution context',
  name: 'config',
  wrap: (_trail, impl) => (input, ctx) => impl(input, ctx),
};
