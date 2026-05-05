import { layerFieldNameDrift } from '../rules/layer-field-name-drift.js';
import { wrapRule } from './wrap-rule.js';

export const layerFieldNameDriftTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'packages/cli/src/build.ts',
        sourceCode: `import { LAYER_FIELD_RESERVED_NAMES } from '@ontrails/core';

const collides = LAYER_FIELD_RESERVED_NAMES.has('all');
`,
      },
      name: 'Allows shared core reserved-name set',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'packages/cli/src/build.ts',
            line: 1,
            message:
              'layer-field-name-drift: surface-local reserved name set "META_FLAG_CANDIDATES" can make layer input fields project differently across surfaces. Import LAYER_FIELD_RESERVED_NAMES from @ontrails/core instead.',
            rule: 'layer-field-name-drift',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'packages/cli/src/build.ts',
        sourceCode: `const META_FLAG_CANDIDATES = new Set(['all']);
`,
      },
      name: 'Flags surface-local reserved-name sets',
    },
  ],
  rule: layerFieldNameDrift,
});
