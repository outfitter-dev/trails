import { workspaceLockOwnership } from '../rules/workspace-lock-ownership.js';
import { wrapRule } from './wrap-rule.js';

export const workspaceLockOwnershipTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'src/app.ts',
        sourceCode: '',
      },
      name: 'Workspace lock ownership runs once at the project boundary',
    },
  ],
  rule: workspaceLockOwnership,
});
