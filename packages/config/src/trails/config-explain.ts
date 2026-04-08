/**
 * Infrastructure trail that exposes config provenance.
 *
 * Returns resolved config entries with source information so agents
 * and operators can answer "where did this value come from?"
 */
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { configProvision } from '../config-resource.js';
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
  prefix
    ? entries.filter(
        (entry) => entry.path === prefix || entry.path.startsWith(`${prefix}.`)
      )
    : entries;

/** Build ExplainConfigOptions from ConfigState, omitting undefined source overrides. */
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

/** Enrich explain options with env and source overrides from state. */
const enrichOptions = (
  state: ConfigState,
  options: ExplainConfigOptions<typeof state.schema>
): ExplainConfigOptions<typeof state.schema> => {
  let enriched = options;
  if (state.env) {
    enriched = { ...enriched, env: state.env };
  }
  if (state.profile) {
    enriched = { ...enriched, profile: state.profile };
  }
  if (state.local) {
    enriched = { ...enriched, local: state.local };
  }
  return enriched;
};

export const configExplain = trail('config.explain', {
  blaze: (input, ctx) => {
    const state = configProvision.from(ctx);
    const options = enrichOptions(state, toExplainOptions(state));
    const entries = explainConfig(options);
    const filtered = filterByPath(entries, input.path);
    return Result.ok({ entries: [...filtered] });
  },
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
  meta: { category: 'infrastructure' },
  output: outputSchema,
  resources: [configProvision],
});
