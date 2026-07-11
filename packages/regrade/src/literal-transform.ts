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

/**
 * Parent input schema with its raw-to-implementation transform attached.
 *
 * Naming the transformed schema lets examples and tests reference both its raw
 * pre-transform input (`z.input`) and its post-transform implementation input
 * (`z.infer`) without restating either shape by hand.
 */
const regradeTransformInputToChild = regradeTransformInput.transform(
  ({ source }) => ({
    child: { source },
  })
);

/**
 * Raw, pre-transform input accepted by {@link regradeTransformInputToChild}.
 *
 * Trail examples and `testExamples()` feed this shape through validation; the
 * Zod transform then projects it into the implementation input.
 */
type RegradeTransformRawInput = z.input<typeof regradeTransformInputToChild>;

/**
 * Post-transform implementation input shape — the trail's inferred input type `I`.
 *
 * TRL-842: With a `.transform()` input schema, the trail's inferred input type
 * `I` is the transform OUTPUT (the implementation input), while examples and
 * `testExamples()` validate the raw pre-transform INPUT. Those two shapes are
 * disjoint, so an authored example must carry raw input typed as the
 * post-transform shape. A framework-level fix would thread a separate
 * `z.input<>` raw-input type parameter through `TrailSpec`, `Trail`, and every
 * `trail()` overload — a core-wide generics change beyond this tracer. Until
 * then the divergence is captured by the two named types here and exercised by
 * the runtime validation test in `__tests__/literal-transform.test.ts`.
 */
type RegradeTransformImplementationInput = z.infer<
  typeof regradeTransformInputToChild
>;

/**
 * Raw example input, statically checked as valid pre-transform input. If the
 * input schema changes so this literal is no longer valid raw input, source
 * typecheck fails here instead of silently relying on the cast below.
 */
const codeStringExampleInput: RegradeTransformRawInput = {
  source: 'export const answer = 41;',
};

export const normalizeExportConstTrail = trail(
  'regrade.literal.normalize-export-const',
  {
    implementation: (input) => {
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
  composes: [normalizeExportConstTrail],
  examples: [
    {
      expected: {
        changed: true,
        nextSource: 'export let answer = 41;',
        notes: ['Rewrote export const declarations to export let.'],
      },
      // TRL-842: author the raw pre-transform value (validated as
      // RegradeTransformRawInput) and widen through `unknown` to the trail's
      // inferred post-transform input type. The runtime still parses raw input;
      // see RegradeTransformImplementationInput for why the two shapes diverge.
      input:
        codeStringExampleInput as unknown as RegradeTransformImplementationInput,
      name: 'code-string fixture',
    },
  ],
  implementation: async (input, ctx) => {
    if (!ctx.compose) {
      return Result.err(
        new InternalError(
          'Literal Regrade tracer requires compose-capable execution.'
        )
      );
    }
    const implementationInput = input as RegradeTransformImplementationInput;
    return await ctx.compose(
      normalizeExportConstTrail,
      implementationInput.child
    );
  },
  input: regradeTransformInputToChild,
  output: regradeTransformOutput,
});

export const literalRegradeTopo = topo('regrade-literal', {
  literalRegradeTrail,
  normalizeExportConstTrail,
});
