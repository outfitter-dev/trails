import { missingReconcile } from '../rules/missing-reconcile.js';
import { wrapRule } from './wrap-rule.js';

export const missingReconcileTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        crudTableIds: ['notes'],
        filePath: 'clean.ts',
        knownTrailIds: ['notes.reconcile'],
        reconcileTableIds: ['notes'],
        sourceCode: `import { store } from '@ontrails/store';
import { z } from 'zod';

const definition = store({
  notes: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      title: z.string(),
    }),
    versioned: true,
  },
});`,
      },
      name: 'Versioned CRUD tables stay clean when reconcile exists',
    },
  ],
  rule: missingReconcile,
});
