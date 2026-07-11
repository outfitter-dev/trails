import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { versionWithoutExamples } from '../rules/trail-versioning-topo.js';
import { wrapTopoRule } from './wrap-rule.js';

const archivedWithoutExamples = trail('version.examples.archived', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  version: 2,
  versions: {
    1: {
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      status: { state: 'archived' },
      transpose: {
        input: () => ({}),
        output: ({ output }) => output,
      },
    },
  },
});

export const versionWithoutExamplesTrail = wrapTopoRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        topo: topo('version-without-examples-clean', {
          archivedWithoutExamples,
        }),
      },
      name: 'Archived entries are exempt from example warnings',
    },
  ],
  rule: versionWithoutExamples,
});
