import { Result, trail } from '@ontrails/core';

import { noThrowInDetourTarget as rule } from '../rules/no-throw-in-detour-target.js';
import type { ProjectContext } from '../rules/types.js';

import { projectAwareRuleInputSchema, ruleOutputSchema } from './schemas.js';

export const noThrowInDetourTargetTrail = trail(
  'warden.rule.no-throw-in-detour-target',
  {
    description: rule.description,
    examples: [
      {
        input: {
          detourTargetTrailIds: ['a.fallback'],
          filePath: 'src/trails/clean.ts',
          knownTrailIds: ['a.fallback'],
          sourceCode:
            "trail('a.fallback', { input: z.object({}), implementation: (i) => Result.ok({}) })",
        },
        name: 'Detour target returns Result',
      },
      {
        input: {
          detourTargetTrailIds: ['a.fallback'],
          filePath: 'src/trails/bad.ts',
          knownTrailIds: ['a.fallback'],
          sourceCode:
            "trail('a.fallback', { input: z.object({}), implementation: (i) => { throw new Error('oops') } })",
        },
        name: 'Detour target throws',
      },
    ],
    implementation: (input) => {
      const context: ProjectContext = {
        detourTargetTrailIds: input.detourTargetTrailIds
          ? new Set(input.detourTargetTrailIds)
          : new Set<string>(),
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
  }
);
