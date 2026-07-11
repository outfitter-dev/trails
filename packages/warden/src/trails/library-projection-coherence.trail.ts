import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { libraryProjectionCoherence } from '../rules/library-projection-coherence.js';
import { wrapTopoRule } from './wrap-rule.js';

const output = z.object({ ok: z.boolean() });

const dotted = trail('widget.ping', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  output,
});

const kebab = trail('widget-ping', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  output,
});

export const libraryProjectionCoherenceTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Library projection export collision on "widgetPing": trails "widget-ping", "widget.ping" derive the same package export. Rename one trail or add a library export override before materializing the generated package.',
            rule: 'library-projection-coherence',
            severity: 'error',
          },
        ],
      },
      input: {
        topo: topo('library-projection-coherence', { dotted, kebab }),
      },
      name: 'Library export collision',
    },
  ],
  rule: libraryProjectionCoherence,
});
