import { noDestructuredCross } from '../rules/no-destructured-cross.js';
import { wrapRule } from './wrap-rule.js';

export const noDestructuredCrossTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.onboard", {
  crosses: ["entity.create"],
  blaze: async (input, ctx) => ctx.cross("entity.create", input),
});`,
      },
      name: 'Clean blaze using ctx.cross directly',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'destructured.ts',
            line: 4,
            message:
              'Trail "entity.onboard" destructures cross from the blaze context. Use ctx.cross(...) directly so composition stays visible and Warden can recognize composed Result values.',
            rule: 'no-destructured-cross',
            severity: 'warn',
          },
        ],
      },
      input: {
        filePath: 'destructured.ts',
        sourceCode: `trail("entity.onboard", {
  crosses: ["entity.create"],
  blaze: async (input, ctx) => {
    const { cross } = ctx;
    return cross("entity.create", input);
  },
});`,
      },
      name: 'Warns when cross is destructured from the blaze context',
    },
  ],
  rule: noDestructuredCross,
});
