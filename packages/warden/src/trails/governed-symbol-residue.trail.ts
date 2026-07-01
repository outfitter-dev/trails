import { governedSymbolResidue } from '../rules/governed-symbol-residue.js';
import { wrapRule } from './wrap-rule.js';

export const governedSymbolResidueTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'packages/example/src/trails/play.ts',
        sourceCode: 'const composeInput = { id: "track" };\n',
      },
      name: 'Current governed symbol vocabulary is clean',
    },
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'packages/example/src/trails/play.ts',
        sourceCode: 'const crossInput = { id: "track" };\n',
      },
      name: 'Cross-compose vocabulary is owned by the beta.19 rule',
    },
  ],
  rule: governedSymbolResidue,
});
