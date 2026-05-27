import { InternalError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

export const regradeTransformInput = z.object({
  source: z.string().describe('Source text to transform'),
});

export const regradeTransformOutput = z.object({
  changed: z.boolean().describe('Whether the transform changed the source'),
  nextSource: z.string().describe('Transformed source text'),
  notes: z.array(z.string()).describe('Tracer notes for the transform run'),
});

const childInput = z.object({
  source: z.string(),
});

export const normalizeExportConstTrail = trail(
  'regrade.literal.normalizeExportConst',
  {
    blaze: (input) => {
      const nextSource = input.source.replaceAll('export const', 'export let');
      return Result.ok({
        changed: nextSource !== input.source,
        nextSource,
        notes:
          nextSource === input.source
            ? ['No export const declaration found.']
            : ['Rewrote export const declarations to export let.'],
      });
    },
    input: childInput,
    output: regradeTransformOutput,
    visibility: 'internal',
  }
);

export const literalRegradeTrail = trail('regrade.literal.run', {
  blaze: async (input, ctx) => {
    if (!ctx.compose) {
      return Result.err(
        new InternalError(
          'Literal Regrade tracer requires compose-capable execution.'
        )
      );
    }
    return await ctx.compose(normalizeExportConstTrail, input.child);
  },
  composes: [normalizeExportConstTrail],
  examples: [
    {
      expected: {
        changed: true,
        nextSource: 'export let answer = 41;',
        notes: ['Rewrote export const declarations to export let.'],
      },
      // Trail examples execute raw input before Zod transforms; the authored type
      // currently reflects the post-transform blaze input shape.
      input: { source: 'export const answer = 41;' } as unknown as {
        child: { source: string };
      },
      name: 'code-string fixture',
    },
  ],
  input: regradeTransformInput.transform(({ source }) => ({
    child: { source },
  })),
  output: regradeTransformOutput,
});

export const literalRegradeTopo = topo('regrade-literal', {
  literalRegradeTrail,
  normalizeExportConstTrail,
});
