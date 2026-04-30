import { errorMappingCompleteness } from '../rules/error-mapping-completeness.js';
import { wrapRule } from './wrap-rule.js';

export const errorMappingCompletenessTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'surface-error-map.ts',
        sourceCode: `import { createSurfaceErrorMapper } from "@ontrails/core";

const cliMapper = createSurfaceErrorMapper({
  auth: 9,
  cancelled: 130,
  conflict: 3,
  internal: 8,
  network: 7,
  not_found: 2,
  permission: 4,
  rate_limit: 6,
  timeout: 5,
  validation: 1,
});`,
      },
      name: 'Complete surface error mapper',
    },
  ],
  rule: errorMappingCompleteness,
});
