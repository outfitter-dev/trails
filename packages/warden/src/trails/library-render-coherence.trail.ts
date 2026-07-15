import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { libraryRenderCoherence } from '../rules/library-render-coherence.js';
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

export const libraryRenderCoherenceTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Library rendering export collision on "widgetPing": trails "widget-ping", "widget.ping" derive the same package export. Rename one trail or add a library export override before materializing the generated package.',
            rule: 'library-render-coherence',
            severity: 'error',
          },
        ],
      },
      input: {
        topo: topo('library-render-coherence', { dotted, kebab }),
      },
      name: 'Library export collision',
    },
  ],
  rule: libraryRenderCoherence,
});
