import { markerSchemaUnsupported } from '../rules/trail-versioning-source.js';
import { wrapRule } from './wrap-rule.js';

export const markerSchemaUnsupportedTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'src/trails/versioned.ts',
        sourceCode: `
trail('versioned.schema', {
  version: 2,
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  implementation: async () => Result.ok({ message: 'ok' }),
});
`,
      },
      name: 'Stable marker-compatible schemas pass',
    },
  ],
  rule: markerSchemaUnsupported,
});
