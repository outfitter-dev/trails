import { Result, trail } from '@ontrails/core';

import { validDetourRefs as rule } from '../rules/valid-detour-refs.js';
import type { ProjectContext } from '../rules/types.js';

import { projectAwareRuleInputSchema, ruleOutputSchema } from './schemas.js';

export const validDetourRefsTrail = trail('warden.rule.valid-detour-refs', {
  description: rule.description,
  examples: [
    {
      input: {
        filePath: 'src/trails/clean.ts',
        knownTrailIds: ['a.create', 'a.fallback'],
        sourceCode:
          "trail('a.create', { detours: { retry: ['a.fallback'] }, input: z.object({}) })",
      },
      name: 'Detour target exists',
    },
    {
      input: {
        filePath: 'src/trails/bad.ts',
        knownTrailIds: ['a.create'],
        sourceCode:
          "trail('a.create', { detours: { retry: ['missing.trail'] }, input: z.object({}) })",
      },
      name: 'Missing detour target',
    },
  ],
  implementation: (input) => {
    const context: ProjectContext = {
      knownTrailIds: new Set(input.knownTrailIds),
    };
    return Result.ok({
      diagnostics: [
        ...rule.checkWithContext(input.sourceCode, input.filePath, context),
      ],
    });
  },
  input: projectAwareRuleInputSchema,
  output: ruleOutputSchema,
});
