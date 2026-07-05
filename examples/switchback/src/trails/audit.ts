import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { flagValueSchema } from '../model.js';
import { auditResource } from '../resources/audit.js';

export const list = trail('audit.list', {
  blaze: (_input, ctx) => {
    const audit = auditResource.from(ctx);
    return Result.ok({ entries: audit.list() });
  },
  description:
    'List the in-memory demo log of bootstrap payloads served by flag.evaluate-all',
  examples: [
    {
      description: 'A fresh process starts with an empty log',
      expected: { entries: [] },
      input: {},
      name: 'Empty audit log',
    },
  ],
  input: z.object({}),
  intent: 'read',
  output: z.object({
    entries: z
      .array(
        z.object({
          subjectId: z.string().describe('Subject the payload was served to'),
          values: z
            .record(z.string(), flagValueSchema)
            .describe('Flag key to served value'),
        })
      )
      .describe('Recorded bootstrap payloads, oldest first'),
  }),
  resources: [auditResource],
});
