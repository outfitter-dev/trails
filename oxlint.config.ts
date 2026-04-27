import { defineConfig } from 'oxlint';
import ultracite from 'ultracite/oxlint/core';

export default defineConfig({
  extends: [ultracite],
  globals: {
    Bun: 'readonly',
  },
  ignorePatterns: ['node_modules/**', 'dist/**', '**/dist/**', '.turbo/**'],
  jsPlugins: [
    {
      name: 'trails-local',
      specifier: '@ontrails/oxlint-plugin',
    },
  ],
  rules: {
    'import/no-nodejs-modules': 'off',
    'import/no-relative-parent-imports': 'off',
    'jsdoc/check-tag-names': [
      'error',
      {
        definedTags: ['remarks'],
      },
    ],
    'require-await': 'off',
    'trails-local/local-plugin-smoke': 'error',
    'typescript/require-await': 'off',
    'unicorn/custom-error-definition': 'off',
    'unicorn/prefer-import-meta-properties': 'off',
    'unicorn/text-encoding-identifier-case': 'off',
  },
});
