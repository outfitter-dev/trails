import { Result, trail } from '@ontrails/core';

import { eventOriginsExist as rule } from '../rules/event-origins-exist.js';
import type { ProjectContext } from '../rules/types.js';

import { projectAwareRuleInputSchema, ruleOutputSchema } from './schemas.js';

export const eventOriginsExistTrail = trail('warden.rule.event-origins-exist', {
  description: rule.description,
  examples: [
    {
      input: {
        filePath: 'src/trails/clean.ts',
        knownTrailIds: ['a.create'],
        sourceCode:
          "trail('a.create', { input: z.object({}) });\nevent('a.created', { from: ['a.create'] })",
      },
      name: 'Origin trail exists',
    },
    {
      input: {
        filePath: 'src/trails/bad.ts',
        knownTrailIds: [],
        sourceCode: "event('a.created', { from: ['missing.trail'] })",
      },
      name: 'Missing origin trail',
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
