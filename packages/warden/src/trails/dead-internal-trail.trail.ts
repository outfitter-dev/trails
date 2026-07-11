import { deadInternalTrail } from '../rules/dead-internal-trail.js';
import { wrapRule } from './wrap-rule.js';

export const deadInternalTrailTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        composeTargetTrailIds: ['entity.sync'],
        filePath: 'clean.ts',
        knownTrailIds: ['entity.public', 'entity.sync'],
        sourceCode: `trail('entity.public', {
  composes: ['entity.sync'],
  implementation: async (_input, ctx) => ctx.compose('entity.sync', {}),
});

trail('entity.sync', {
  visibility: 'internal',
  implementation: async () => Result.ok({}),
});`,
      },
      name: 'Internal trails stay clean when another trail composes them',
    },
  ],
  rule: deadInternalTrail,
});
