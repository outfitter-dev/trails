import { defineRule } from '@oxlint/plugins';

const SMOKE_MARKER = 'oxlint-local-plugin-smoke';

export const localPluginSmoke = defineRule({
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.value.includes(SMOKE_MARKER)) {
            context.report({
              loc: comment.loc,
              messageId: 'loaded',
            });
          }
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        'Smoke test proving the Trails repo-local oxlint plugin is loaded.',
    },
    messages: {
      loaded:
        'The Trails repo-local oxlint plugin is loaded and reporting diagnostics.',
    },
    type: 'problem',
  },
});
