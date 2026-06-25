import type { FieldOverride } from '@ontrails/core';
import { Result, trail } from '@ontrails/core';
import {
  buildWardenGuideManifest,
  formatWardenGuide,
  wardenDepthValues,
  wardenFixClasses,
  wardenFixSafeties,
  wardenGuideFormatValues,
  wardenRuleConcerns,
  wardenRuleLifecycleStates,
  wardenRuleScopes,
  wardenRuleTiers,
} from '@ontrails/warden';
import { z } from 'zod';

const wardenGuidanceLinkSchema = z.object({
  label: z.string(),
  path: z.string().optional(),
  url: z.string().optional(),
});

const wardenGuidanceSchema = z.object({
  commands: z.array(z.string()).readonly().optional(),
  docs: z.array(wardenGuidanceLinkSchema).readonly().optional(),
  relatedRules: z.array(z.string()).readonly().optional(),
  steps: z.array(z.string()).readonly().optional(),
  summary: z.string(),
});

const wardenRuleGuideEntrySchema = z.object({
  concern: z.enum(wardenRuleConcerns),
  depth: z.enum(wardenDepthValues),
  description: z.string(),
  docs: z.array(wardenGuidanceLinkSchema).readonly(),
  fix: z
    .object({
      class: z.enum(wardenFixClasses),
      safety: z.enum(wardenFixSafeties),
      scanTargets: z
        .object({
          extensions: z.array(z.string()).readonly().optional(),
          ignoredDirectories: z.array(z.string()).readonly().optional(),
        })
        .optional(),
    })
    .optional(),
  guidance: wardenGuidanceSchema.optional(),
  id: z.string(),
  invariant: z.string(),
  lifecycle: z.object({
    retireWhen: z.string().optional(),
    state: z.enum(wardenRuleLifecycleStates),
  }),
  scope: z.enum(wardenRuleScopes),
  severity: z.enum(['error', 'warn']),
  tier: z.enum(wardenRuleTiers),
});

const wardenGuideManifestSchema = z.object({
  generatedFrom: z.object({
    package: z.literal('@ontrails/warden'),
    registries: z
      .tuple([z.literal('wardenRules'), z.literal('wardenTopoRules')])
      .readonly(),
    source: z.literal('builtin-rule-metadata'),
  }),
  kind: z.literal('trails-warden-guide-manifest'),
  ruleCount: z.number(),
  rules: z.array(wardenRuleGuideEntrySchema).readonly(),
  version: z.literal(1),
});

const wardenGuideInputSchema = z.object({
  guideFormat: z
    .enum(wardenGuideFormatValues)
    .default('markdown')
    .describe('Guide output format'),
});

const wardenGuideFields = {
  guideFormat: {
    aliases: true,
    options: [
      {
        hint: 'Human-readable Warden guide',
        label: 'Markdown',
        value: 'markdown',
      },
      {
        hint: 'Compact guidance for agent context',
        label: 'Agent JSON',
        value: 'agent-json',
      },
      {
        hint: 'Full structured rule manifest',
        label: 'Manifest',
        value: 'manifest',
      },
    ],
  },
} satisfies Readonly<
  Record<'guideFormat', FieldOverride & { readonly aliases: true }>
>;

export const wardenGuideTrail = trail('warden.guide', {
  blaze: (input) => {
    const manifest = buildWardenGuideManifest();
    return Result.ok({
      format: input.guideFormat,
      formatted: formatWardenGuide(manifest, input.guideFormat),
      manifest,
    });
  },
  description: 'Project Warden rule guidance as markdown or JSON',
  examples: [
    {
      input: { guideFormat: 'markdown' },
      name: 'Markdown guide',
    },
    {
      input: { guideFormat: 'agent-json' },
      name: 'Agent JSON guide',
    },
  ],
  fields: wardenGuideFields,
  input: wardenGuideInputSchema,
  intent: 'read',
  output: z.object({
    format: z.enum(wardenGuideFormatValues),
    formatted: z.string(),
    manifest: wardenGuideManifestSchema,
  }),
});
