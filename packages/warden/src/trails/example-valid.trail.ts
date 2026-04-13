import { exampleValid } from '../rules/example-valid.js';
import { wrapRule } from './wrap-rule.js';

export const exampleValidTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'contours.ts',
        sourceCode: `const user = contour("user", {
  id: z.string().uuid(),
  name: z.string(),
}, {
  examples: [{
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Ada",
  }],
  identity: "id",
});`,
      },
      name: 'Contour examples validate against their schema',
    },
  ],
  rule: exampleValid,
});
