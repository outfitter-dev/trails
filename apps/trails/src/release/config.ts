import { z } from 'zod';

export const releaseFactTypeValues = [
  'package-content',
  'public-trail-contract',
] as const;

export const releaseIntentSourceValues = [
  'changeset',
  'no-release-override',
] as const;

export const releaseRuleSeverityValues = ['error', 'warning'] as const;

export const releaseFactTypeSchema = z.enum(releaseFactTypeValues);
export const releaseIntentSourceSchema = z.enum(releaseIntentSourceValues);
export const releaseRuleSeveritySchema = z.enum(releaseRuleSeverityValues);

export const releaseRuleSchema = z.object({
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  facts: z.array(releaseFactTypeSchema).min(1),
  id: z.string().min(1),
  intent: z.array(releaseIntentSourceSchema).min(1).default(['changeset']),
  severity: releaseRuleSeveritySchema.default('error'),
});

export type ReleaseFactType = z.output<typeof releaseFactTypeSchema>;
export type ReleaseIntentSource = z.output<typeof releaseIntentSourceSchema>;
export type ReleaseRule = z.output<typeof releaseRuleSchema>;
export type ReleaseRuleInput = z.input<typeof releaseRuleSchema>;

export const defaultReleaseRules = [
  {
    description:
      'Publishable package content changes require positive release intent.',
    enabled: true,
    facts: ['package-content'],
    id: 'package-content-requires-intent',
    intent: ['changeset', 'no-release-override'],
    severity: 'error',
  },
  {
    description:
      'Public trail contract changes require positive release intent.',
    enabled: true,
    facts: ['public-trail-contract'],
    id: 'public-trail-contract-requires-intent',
    intent: ['changeset', 'no-release-override'],
    severity: 'error',
  },
] as const satisfies readonly ReleaseRuleInput[];

export const releaseConfigSchema = z
  .object({
    rules: z.array(releaseRuleSchema).default(() => [...defaultReleaseRules]),
  })
  .default({ rules: [...defaultReleaseRules] });

export type ReleaseConfig = z.output<typeof releaseConfigSchema>;
export type ReleaseConfigInput = z.input<typeof releaseConfigSchema>;

export const defaultReleaseConfig = releaseConfigSchema.parse({});
