import { noDestructuredCompose } from '../rules/no-destructured-compose.js';
import { wrapRule } from './wrap-rule.js';

export const noDestructuredComposeTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.onboard", {
  composes: ["entity.create"],
  implementation: async (input, ctx) => ctx.compose("entity.create", input),
});`,
      },
      name: 'Clean implementation using ctx.compose directly',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'destructured.ts',
            line: 4,
            message:
              'Trail "entity.onboard" destructures compose from the implementation context. Use ctx.compose(...) directly so composition stays visible and Warden can recognize composed Result values.',
            rule: 'no-destructured-compose',
            severity: 'warn',
          },
        ],
      },
      input: {
        filePath: 'destructured.ts',
        sourceCode: `trail("entity.onboard", {
  composes: ["entity.create"],
  implementation: async (input, ctx) => {
    const { compose } = ctx;
    return compose("entity.create", input);
  },
});`,
      },
      name: 'Warns when compose is destructured from the implementation context',
    },
  ],
  rule: noDestructuredCompose,
});
