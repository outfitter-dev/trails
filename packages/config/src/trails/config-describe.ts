/**
 * Infrastructure trail that describes all config fields in a schema.
 *
 * Returns a structured catalog of field definitions suitable for
 * CLI rendering or agent inspection.
 */
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { configProvision } from '../config-resource.js';
import { describeConfig } from '../describe.js';

const fieldSchema = z.object({
  deprecated: z.string().optional(),
  description: z.string().optional(),
  env: z.string().optional(),
  path: z.string(),
  required: z.boolean(),
  secret: z.boolean().optional(),
  type: z.string(),
});

const outputSchema = z.object({
  fields: z.array(fieldSchema),
});

export const configDescribe = trail('config.describe', {
  blaze: (_input, ctx) => {
    const state = configProvision.from(ctx);
    const fields = describeConfig(state.schema);
    return Result.ok({ fields: [...fields] });
  },
  examples: [
    {
      input: {},
      name: 'Describe all config fields',
    },
  ],
  input: z.object({}),
  intent: 'read',
  meta: { category: 'infrastructure' },
  output: outputSchema,
  resources: [configProvision],
});
