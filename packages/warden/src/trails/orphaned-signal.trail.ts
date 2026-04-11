import { orphanedSignal } from '../rules/orphaned-signal.js';
import { wrapRule } from './wrap-rule.js';

export const orphanedSignalTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        crudTableIds: ['notes'],
        filePath: 'clean.ts',
        knownTrailIds: ['notes.notify'],
        onTargetSignalIds: ['notes.created', 'notes.updated', 'notes.removed'],
        sourceCode: `import { store } from '@ontrails/store';
import { z } from 'zod';

const definition = store({
  notes: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      title: z.string(),
    }),
  },
});`,
      },
      name: 'Derived store signals stay quiet when trail listeners exist',
    },
  ],
  rule: orphanedSignal,
});
