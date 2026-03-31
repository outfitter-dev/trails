/**
 * Infrastructure trail that exposes config provenance.
 *
 * Returns resolved config entries with source information so agents
 * and operators can answer "where did this value come from?"
 */
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { configService } from '../config-service.js';
import type { ExplainConfigOptions } from '../explain.js';
import { explainConfig } from '../explain.js';
import type { ConfigState } from '../registry.js';

const provenanceEntrySchema = z.object({
  path: z.string(),
  redacted: z.boolean(),
  source: z.string(),
  value: z.unknown(),
});

const outputSchema = z.object({
  entries: z.array(provenanceEntrySchema),
});

/** Filter provenance entries by path prefix when specified. */
const filterByPath = (
  entries: readonly { readonly path: string }[],
  prefix: string
): readonly { readonly path: string }[] =>
  prefix ? entries.filter((e) => e.path.startsWith(prefix)) : entries;

/** Build ExplainConfigOptions from ConfigState, omitting undefined layers. */
const toExplainOptions = (
  state: ConfigState
): ExplainConfigOptions<typeof state.schema> => {
  const base: ExplainConfigOptions<typeof state.schema> = {
    resolved: state.resolved,
    schema: state.schema,
  };
  if (state.base) {
    return { ...base, base: state.base };
  }
  return base;
};

/** Enrich explain options with env and layer overrides from state. */
const enrichOptions = (
  state: ConfigState,
  options: ExplainConfigOptions<typeof state.schema>
): ExplainConfigOptions<typeof state.schema> => {
  let enriched = options;
  if (state.env) {
    enriched = { ...enriched, env: state.env };
  }
  if (state.loadout) {
    enriched = { ...enriched, loadout: state.loadout };
  }
  if (state.local) {
    enriched = { ...enriched, local: state.local };
  }
  return enriched;
};

export const configExplain = trail('config.explain', {
  examples: [
    {
      input: {},
      name: 'Explain all fields',
    },
  ],
  input: z.object({
    path: z
      .string()
      .describe('Config field path to explain (or empty for all)')
      .default(''),
  }),
  intent: 'read',
  metadata: { category: 'infrastructure' },
  output: outputSchema,
  run: (input, ctx) => {
    const state = configService.from(ctx);
    const options = enrichOptions(state, toExplainOptions(state));
    const entries = explainConfig(options);
    const filtered = filterByPath(entries, input.path);
    return Result.ok({ entries: [...filtered] });
  },
  services: [configService],
});
