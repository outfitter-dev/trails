import { fileURLToPath } from 'node:url';

import { ownerRenderParity } from '../rules/owner-render-parity.js';
import { wrapRule } from './wrap-rule.js';

export const ownerRenderParityTrail = wrapRule({
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
      name: 'HTTP method rendering covers core intent values',
    },
  ],
  rule: ownerRenderParity,
});
