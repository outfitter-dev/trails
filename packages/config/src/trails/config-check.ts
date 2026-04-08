/**
 * Infrastructure trail that validates config values against a schema.
 *
 * Returns structured diagnostics indicating which fields are valid,
 * missing, invalid, deprecated, or using defaults.
 */
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { configProvision } from '../config-resource.js';
import { checkConfig } from '../doctor.js';
import { deepMerge } from '../merge.js';

const diagnosticSchema = z.object({
  message: z.string(),
  path: z.string(),
  status: z.enum(['valid', 'missing', 'invalid', 'deprecated', 'default']),
});

const outputSchema = z.object({
  diagnostics: z.array(diagnosticSchema),
  valid: z.boolean(),
});

/** Merge input values on top of resolved config values. */
const mergeValues = (
  resolved: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> => {
  const hasOverrides = Object.keys(overrides).length > 0;
  return hasOverrides ? deepMerge(resolved, overrides) : resolved;
};

export const configCheck = trail('config.check', {
  blaze: (input, ctx) => {
    const state = configProvision.from(ctx);
    const effective = mergeValues(state.resolved, input.values);
    const checked = checkConfig(state.schema, effective);
    return Result.ok({
      diagnostics: [...checked.diagnostics],
      valid: checked.valid,
    });
  },
  examples: [
    {
      input: {},
      name: 'Check current config',
    },
  ],
  input: z.object({
    values: z
      .record(z.string(), z.unknown())
      .describe('Config values to check (merged with resolved)')
      .default({}),
  }),
  intent: 'read',
  meta: { category: 'infrastructure' },
  output: outputSchema,
  resources: [configProvision],
});
