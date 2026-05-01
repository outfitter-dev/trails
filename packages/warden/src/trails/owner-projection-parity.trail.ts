import { fileURLToPath } from 'node:url';

import { ownerProjectionParity } from '../rules/owner-projection-parity.js';
import { wrapRule } from './wrap-rule.js';

export const ownerProjectionParityTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: fileURLToPath(
          new URL('../../../http/src/method.ts', import.meta.url)
        ),
        sourceCode: `import type { Intent } from '@ontrails/core';

export const httpMethodByIntent = {
  destroy: 'DELETE',
  read: 'GET',
  write: 'POST',
} as const satisfies Record<Intent, 'GET' | 'POST' | 'DELETE'>;`,
      },
      name: 'HTTP method projection covers core intent values',
    },
  ],
  rule: ownerProjectionParity,
});
