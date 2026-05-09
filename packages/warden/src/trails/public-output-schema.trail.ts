import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { publicOutputSchema } from '../rules/public-output-schema.js';
import { wrapTopoRule } from './wrap-rule.js';

const cleanTrail = trail('report.read', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

const cleanTopo = topo('public-output-schema-clean', {
  cleanTrail,
});

const missingOutputTrail = trail('report.missing', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
});

const missingOutputTopo = topo('public-output-schema-missing', {
  missingOutputTrail,
});

export const publicOutputSchemaTrail = wrapTopoRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        topo: cleanTopo,
      },
      name: 'Public surface trails declare output schemas',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Trail "report.missing" is visible to public MCP/HTTP surface projection but does not declare an output schema. Add an explicit output schema, or mark the trail visibility as internal if it is composition-only.',
            rule: 'public-output-schema',
            severity: 'error',
          },
        ],
      },
      input: {
        topo: missingOutputTopo,
      },
      name: 'Public surface trails without output schemas are flagged',
    },
  ],
  rule: publicOutputSchema,
});
