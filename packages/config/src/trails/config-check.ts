/**
 * Infrastructure trail that validates config values against a schema.
 *
 * Returns structured field reports indicating which fields are valid,
 * missing, invalid, deprecated, or using defaults.
 */
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { configResource } from '../config-resource.js';
import { collectConfigMeta } from '../collect.js';
import { checkConfig } from '../doctor.js';
import { deepMerge } from '../merge.js';
import { isLikelySecret } from '../secret-heuristics.js';

const fieldReportSchema = z.object({
  message: z.string(),
  path: z.string(),
  redacted: z.boolean().optional(),
  status: z.enum(['valid', 'missing', 'invalid', 'deprecated', 'default']),
  value: z.unknown().optional(),
});

const outputSchema = z.object({
  fields: z.array(fieldReportSchema),
  valid: z.boolean(),
});

type ConfigCheckFieldReport = ReturnType<typeof checkConfig>['fields'][number] &
  Readonly<{
    redacted?: boolean;
  }>;

/** Merge input values on top of resolved config values. */
const mergeValues = (
  resolved: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> => {
  const hasOverrides = Object.keys(overrides).length > 0;
  return hasOverrides ? deepMerge(resolved, overrides) : resolved;
};

const redactSecretFields = (
  schema: z.ZodObject<Record<string, z.ZodType>>,
  fields: ReturnType<typeof checkConfig>['fields']
): ConfigCheckFieldReport[] => {
  const meta = collectConfigMeta(schema);
  const redactedPaths = new Set(
    [...meta.entries()]
      .filter(
        ([, fieldMeta]) =>
          fieldMeta.secret === true ||
          (fieldMeta.env !== undefined && isLikelySecret(fieldMeta.env))
      )
      .map(([path]) => path)
  );
  return fields.map((field) => {
    const shouldRedact = [...redactedPaths].some(
      (path) => field.path === path || field.path.startsWith(`${path}.`)
    );
    if (!shouldRedact || !('value' in field) || field.value === undefined) {
      return field;
    }

    return { ...field, redacted: true, value: '[REDACTED]' };
  });
};

export const configCheck = trail('config.check', {
  examples: [
    {
      input: {},
      name: 'Check current config',
    },
  ],
  implementation: (input, ctx) => {
    const state = configResource.from(ctx);
    const effective = mergeValues(state.resolved, input.values);
    const checked = checkConfig(state.schema, effective);
    return Result.ok({
      fields: redactSecretFields(state.schema, checked.fields),
      valid: checked.valid,
    });
  },
  input: z.object({
    values: z
      .record(z.string(), z.unknown())
      .describe('Config values to check (merged with resolved)')
      .default({}),
  }),
  intent: 'read',
  meta: { category: 'infrastructure' },
  output: outputSchema,
  resources: [configResource],
});
