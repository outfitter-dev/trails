import { forkWithoutPreservedImplementation } from '../rules/trail-versioning-source.js';
import { wrapRule } from './wrap-rule.js';

export const forkWithoutPreservedImplementationTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'src/trails/versioned.ts',
        sourceCode: `
trail('versioned.clean', {
  version: 2,
  versions: {
    1: {
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
    },
  },
  implementation: async () => Result.ok({ message: 'ok' }),
});
`,
      },
      name: 'Revision entries use transpose',
    },
  ],
  rule: forkWithoutPreservedImplementation,
});
