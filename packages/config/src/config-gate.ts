/**
 * Config gate — attaches resolved config to the execution context.
 *
 * For v1, the gate is a pass-through: config resolution happens at
 * bootstrap time and the provision pipeline (TRL-91) injects the resolved
 * config before any trail runs. The gate reserves a named slot so future
 * versions can add per-trail config overrides or validation.
 */
import type { Gate } from '@ontrails/core';

export const configGate: Gate = {
  description: 'Ensures resolved config is available in the execution context',
  name: 'config',
  wrap: (_trail, impl) => (input, ctx) => impl(input, ctx),
};
