import { normalizeFilePath, reportNode } from './shared.js';
import type { RuleModule } from './shared.js';

const SPEC_FILE_PATTERN = /\.spec\.[cm]?[jt]sx?$/u;

export const testFileNamingRule: RuleModule = {
  create(context) {
    return {
      Program(node) {
        if (!SPEC_FILE_PATTERN.test(normalizeFilePath(context.filename))) {
          return;
        }

        reportNode({
          context,
          messageId: 'testFileNaming',
          node,
        });
      },
    };
  },
  meta: {
    docs: {
      description:
        "Warn when test files use .spec.* naming instead of Bun's .test.* convention.",
      recommended: true,
    },
    messages: {
      testFileNaming:
        'Use .test.* naming instead of .spec.* for Bun test files.',
    },
    schema: [],
    type: 'suggestion',
  },
};
