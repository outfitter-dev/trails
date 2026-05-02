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
    'trails-local/no-console-in-packages': [
      'error',
      { allowedPackages: ['logging', 'observe'] },
    ],
    'trails-local/no-deep-relative-import': ['warn', { maxParentSegments: 2 }],
    'trails-local/no-nested-barrel': ['warn', { maxDepth: 2 }],
    'trails-local/no-process-env-in-packages': [
      'warn',
      { allowedPackages: ['cli', 'config', 'core', 'logging'] },
    ],
    'trails-local/no-process-exit-in-packages': [
      'error',
      { allowedPackages: ['cli'] },
    ],
    'trails-local/prefer-bun-api': 'warn',
    'trails-local/snapshot-location': 'warn',
    'trails-local/temp-audit-direct-framework-writes': 'warn',
    'trails-local/test-file-naming': 'warn',
    'typescript/require-await': 'off',
    'unicorn/custom-error-definition': 'off',
    'unicorn/prefer-import-meta-properties': 'off',
    'unicorn/text-encoding-identifier-case': 'off',
  },
});
