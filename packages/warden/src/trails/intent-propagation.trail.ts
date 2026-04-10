import { intentPropagation } from '../rules/intent-propagation.js';
import { wrapRule } from './wrap-rule.js';

export const intentPropagationTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        knownTrailIds: ['entity.read', 'entity.lookup'],
        sourceCode: `trail('entity.read', {
  intent: 'read',
  crosses: ['entity.lookup'],
  blaze: async (_input, ctx) => ctx.cross('entity.lookup', {}),
});

trail('entity.lookup', {
  intent: 'read',
  blaze: async () => Result.ok({}),
});`,
        trailIntentsById: {
          'entity.lookup': 'read',
          'entity.read': 'read',
        },
      },
      name: 'Read trails may cross other read trails',
    },
  ],
  rule: intentPropagation,
});
