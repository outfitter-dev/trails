import { noNativeErrorResult } from '../rules/no-native-error-result.js';
import { wrapRule } from './wrap-rule.js';

export const noNativeErrorResultTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'entity.ts',
        sourceCode: `import { InternalError, Result } from "@ontrails/core";

export const load = () => Result.err(new InternalError("failed"));`,
      },
      name: 'Specific TrailsError subclasses stay clean',
    },
  ],
  rule: noNativeErrorResult,
});
