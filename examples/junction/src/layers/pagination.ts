/**
 * Pagination layer for list trails.
 *
 * The layer owns the `limit`/`offset` input fields: surfaces render them
 * alongside the trail's own input (HTTP query params, CLI flags, MCP tool
 * params), and the layer applies them to the trail's full result set. List
 * implementations stay pagination-free — they return every matching item and this
 * layer windows the response.
 */

import { LAYER_INPUTS_KEY } from '@ontrails/core';
import type { Layer } from '@ontrails/core';
import { z } from 'zod';

const paginationInputSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .default(20)
    .describe('Maximum items to return'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Items to skip before the first result'),
});

const isPaginatedShape = (
  value: unknown
): value is { readonly items: readonly unknown[] } =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { items?: unknown }).items);

/** Wrap a paginated output schema around an item schema. */
export const paginatedOutput = <T>(itemSchema: z.ZodType<T>) =>
  z.object({
    hasMore: z
      .boolean()
      .describe('Whether more items exist beyond this window'),
    items: z.array(itemSchema).describe('Items in the current window'),
    total: z.number().int().describe('Total matching items before windowing'),
  });

export const paginationLayer: Layer = {
  description:
    'Windows list results with limit/offset input rendered by every surface.',
  input: paginationInputSchema,
  name: 'pagination',
  wrap(_trail, implementation) {
    return async (input, ctx) => {
      const layerInputs = ctx.extensions?.[LAYER_INPUTS_KEY];
      const rawWindow =
        typeof layerInputs === 'object' && layerInputs !== null
          ? (layerInputs as Record<string, unknown>)['pagination']
          : undefined;
      const parsed = paginationInputSchema.safeParse(rawWindow ?? {});
      const window = parsed.success ? parsed.data : { limit: 20, offset: 0 };

      const result = await implementation(input, ctx);
      return result.map((output) => {
        if (!isPaginatedShape(output)) {
          return output;
        }
        const items = output.items.slice(
          window.offset,
          window.offset + window.limit
        );
        return {
          ...output,
          hasMore: window.offset + window.limit < output.items.length,
          items,
          total: output.items.length,
        } as typeof output;
      });
    };
  },
};
