import { deadInternalTrail } from '../rules/dead-internal-trail.js';
import { wrapRule } from './wrap-rule.js';

export const deadInternalTrailTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        crossTargetTrailIds: ['entity.sync'],
        filePath: 'clean.ts',
        knownTrailIds: ['entity.public', 'entity.sync'],
        sourceCode: `trail('entity.public', {
  crosses: ['entity.sync'],
  blaze: async (_input, ctx) => ctx.cross('entity.sync', {}),
});

trail('entity.sync', {
  visibility: 'internal',
  blaze: async () => Result.ok({}),
});`,
      },
      name: 'Internal trails stay clean when another trail crosses them',
    },
  ],
  rule: deadInternalTrail,
});
