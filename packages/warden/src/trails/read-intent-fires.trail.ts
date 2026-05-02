import { readIntentFires } from '../rules/read-intent-fires.js';
import { wrapRule } from './wrap-rule.js';

export const readIntentFiresTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `const entityLoaded = signal('entity.loaded', { payload: z.object({}) });
trail('entity.read', {
  intent: 'read',
  blaze: async () => Result.ok({}),
});`,
      },
      name: 'Read trails without fires stay quiet',
    },
  ],
  rule: readIntentFires,
});
